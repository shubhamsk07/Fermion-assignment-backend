import http, { IncomingMessage, ServerResponse } from "http";
import WebSocket, { WebSocketServer } from "ws";
import mediasoup from "mediasoup";
import fs from "fs";
import { ChildProcessWithoutNullStreams, spawn } from "child_process";
import { createWorker } from "./worker";
import { Router } from "mediasoup/node/lib/RouterTypes";
import { Transport } from "mediasoup/node/lib/TransportTypes";
import { Producer } from "mediasoup/node/lib/ProducerTypes";
import { Consumer } from "mediasoup/node/lib/ConsumerTypes";
import { createWebRtcTransport } from "./createWebrtcTransport";
import express from "express";
import https from "https";
import cors from "cors";

let ffmpegProcess: any;

const PORT = 3001;

// at top of file
let nextClientId = 1;

interface ClientData {
  ws: WebSocket;
  id: string;
  producerTransport?: Transport;
  consumerTransport?: Transport;
  producers: Map<string, Producer>; // <-- track all producers for this client
  consumers: Map<string, Consumer>;
}

let mediasoupRouter: Router;
const clients = new Map<WebSocket, ClientData>();
const producers = new Map<string, Producer>();

const app = express();

app.use(cors());
app.use(express.json());
const httpsOptions = {
  key: fs.readFileSync("./keys/localhost+2-key.pem"),
  cert: fs.readFileSync("./keys/localhost+2.pem"),
};
const server = https.createServer(httpsOptions, app);
const wss = new WebSocketServer({ server });

(async () => {
  try {
    mediasoupRouter = await createWorker();
    console.log("created router");
  } catch (error) {
    throw error;
  }
})();

wss.on("connection", (ws: WebSocket) => {
  const clientId = `peer${nextClientId++}`;
  clients.set(ws, {
    ws,
    id: clientId,
    producers: new Map(),
    consumers: new Map(),
  });

  ws.on("message", (data: WebSocket.RawData) => {
    const event = JSON.parse(data.toString());
    console.log(event.type, "event type");
    const clientData = clients.get(ws)!;
    switch (event.type) {
      case "getRouterCapabilities":
        ws.send(
          JSON.stringify({
            type: "getRouterCapabilities",
            data: mediasoupRouter.rtpCapabilities,
          })
        );
        break;
      case "createProducerTransport":
        (async () => {
          try {
            const { transport, params } = await createWebRtcTransport(mediasoupRouter);
            clientData.producerTransport = transport;

            console.log("ProducerTransportCreated");
            ws.send(
              JSON.stringify({
                type: "ProducerTransportCreated",
                data: params,
              })
            );
          } catch (error) {
            console.error("Error creating producer transport:", error);
            ws.send(JSON.stringify({ type: "error", message: error }));
          }
        })();
        break;
      case "connectProducerTransport":
        (async () => {
          try {
            if (!clientData.producerTransport) {
              throw new Error("Producer transport not found");
            }
            console.log("event", event);
            await clientData.producerTransport.connect({
              dtlsParameters: event.dtlsParameters,
            });
            console.log("got ahead");
            ws.send(
              JSON.stringify({
                type: "producerConnected",
                message: "producer connected",
              })
            );
          } catch (error) {
            console.error("Error connecting producer transport:", error);
            ws.send(JSON.stringify({ type: "error", message: error }));
          }
        })();
        break;
      // Replace the existing auto-start FFmpeg logic in the "produce" case with this:

case "produce":
  (async () => {
    try {
      const { kind, rtpParameters } = event;
      if (!clientData.producerTransport) {
        throw new Error("Producer transport not found");
      }

      // create producer and tag with appData so we can find matching audio/video later
      const producer = await clientData.producerTransport.produce({
        kind,
        rtpParameters,
        appData: { clientId: clientData.id, media: kind }, // e.g. media: 'audio' or 'video'
      });

      // store producer per-client and globally
      clientData.producers.set(producer.id, producer);
      producers.set(producer.id, producer);

      ws.send(
        JSON.stringify({
          type: "published",
          data: { id: producer.id, kind: producer.kind },
        })
      );

      // notify other clients about this new producer (include kind + clientId)
      clients.forEach((otherClientData, otherWs) => {
        if (otherWs !== ws) {
          otherWs.send(
            JSON.stringify({
              type: "newProducer",
              producerId: producer.id,
              kind: producer.kind,
              clientId: clientData.id,
            })
          );
        }
      });

      // --- FIXED: Wait for both video AND audio before starting FFmpeg ---
      // Add a delay to ensure all producers are ready, then check conditions
      setTimeout(async () => {
        if (ffmpegProcess) return; // Already running

        const videoProducers = Array.from(producers.values()).filter((p) => p.kind === "video");
        const audioProducers = Array.from(producers.values()).filter((p) => p.kind === "audio");

        // Only start if we have at least 2 video producers AND their corresponding audio
        if (videoProducers.length >= 2) {
          // Get first two video producers from different clients
          const v1 = videoProducers[0];
          const v2 = videoProducers.find(v => v.appData?.clientId !== v1.appData?.clientId) || videoProducers[1];

          // Find matching audio producers
          const a1 = audioProducers.find(
            (p) => p.appData?.clientId === v1.appData?.clientId
          );
          const a2 = audioProducers.find(
            (p) => p.appData?.clientId === v2.appData?.clientId
          );

          console.log(`Found producers - Video: ${videoProducers.length}, Audio: ${audioProducers.length}`);
          console.log(`Client 1 (${v1.appData?.clientId}): Video=${!!v1}, Audio=${!!a1}`);
          console.log(`Client 2 (${v2.appData?.clientId}): Video=${!!v2}, Audio=${!!a2}`);

          // Start FFmpeg with whatever audio we have (can be null)
          await startFFmpegStreaming({
            videoProducer1: v1,
            audioProducer1: a1 || null,
            videoProducer2: v2,
            audioProducer2: a2 || null,
          });
        }
      }, 1000); // 1 second delay to ensure all tracks are produced

    } catch (error) {
      console.error("Error producing:", error);
      ws.send(JSON.stringify({ type: "error", message: String(error) }));
    }
  })();
  break;  case "createConsumerTransport":
        (async () => {
          try {
            const { transport, params } = await createWebRtcTransport(mediasoupRouter);
            clientData.consumerTransport = transport;
            ws.send(
              JSON.stringify({
                type: "ConsumerTransportCreated",
                data: params,
              })
            );
          } catch (error) {
            console.error("Error creating consumer transport:", error);
            ws.send(JSON.stringify({ type: "error", message: error }));
          }
          producers.forEach((producer) => {
            // skip notifying the same client about their own producers
            if (producer.appData?.clientId !== clientData.id) {
              ws.send(
                JSON.stringify({
                  type: "newProducer",
                  producerId: producer.id,
                  kind: producer.kind,
                  clientId: producer.appData?.clientId || null,
                })
              );
            }
          });
        })();
        break;

      case "connectConsumerTransport":
        (async () => {
          try {
            if (!clientData.consumerTransport) {
              throw new Error("Consumer transport not found");
            }
            await clientData.consumerTransport.connect({
              dtlsParameters: event.dtlsParameters,
            });
            ws.send(
              JSON.stringify({
                type: "consumerConnected",
                message: "consumer connected",
              })
            );
          } catch (error) {
            console.error("Error connecting consumer transport:", error);
            ws.send(JSON.stringify({ type: "error", message: error }));
          }
        })();
        break;
      case "consume":
        (async () => {
          try {
            console.log("consumer point");
            const { producerId, rtpCapabilities } = event;
            if (!clientData.consumerTransport) {
              throw new Error("Consumer transport not found");
            }
            const producer = producers.get(producerId);
            if (!producer) {
              throw new Error("Producer not found");
            }
            if (!mediasoupRouter.canConsume({ producerId, rtpCapabilities })) {
              throw new Error("Cannot consume");
            }
            const consumer = await clientData.consumerTransport.consume({
              producerId,
              rtpCapabilities,
              paused: true, // Start paused
            });
            clientData.consumers.set(consumer.id, consumer);
            ws.send(
              JSON.stringify({
                type: "consumed",
                data: {
                  id: consumer.id,
                  producerId: consumer.producerId,
                  kind: consumer.kind,
                  rtpParameters: consumer.rtpParameters,
                },
              })
            );
          } catch (error) {}
        })();
        break;
      case "resumeConsumer":
        (async () => {
          try {
            const { consumerId } = event;
            const consumer = clientData.consumers.get(consumerId);
            if (!consumer) {
              console.log("insider resume");
              throw new Error("Consumer not found");
            }
            await consumer.resume();

            try {
              consumer.requestKeyFrame();
            } catch (e) {
              console.warn("requestKeyFrame failed:", e);
            }
            ws.send(
              JSON.stringify({
                type: "consumerResumed",
                consumerId,
              })
            );
          } catch (error) {
            console.error("Error resuming consumer:", error);
            ws.send(JSON.stringify({ type: "error", message: error }));
          }
        })();
        break;
    }
  });

ws.on("close", () => {
  console.log("client disconnected");
  const clientData = clients.get(ws);
  if (clientData) {
    // Remove all producers of this client
    for (const [pid, prod] of clientData.producers.entries()) {
      try { prod.close(); } catch(e) { /* ignore */ }
      producers.delete(pid);

      // notify others
      clients.forEach((otherClientData, otherWs) => {
        if (otherWs !== ws) {
          otherWs.send(JSON.stringify({
            type: "producerClosed",
            producerId: pid,
            clientId: clientData.id
          }));
        }
      });
    }

    if (clientData.producerTransport) clientData.producerTransport.close();
    if (clientData.consumerTransport) clientData.consumerTransport.close();

    // Clean up consumers
    clientData.consumers.forEach((consumer) => { consumer.close(); });
  }
  clients.delete(ws);
});

  console.log("Client connected, total clients:", clients.size);
});

async function startFFmpegStreaming({
  videoProducer1,
  audioProducer1,
  videoProducer2,
  audioProducer2,
}: {
  videoProducer1: mediasoup.types.Producer;
  audioProducer1: mediasoup.types.Producer | null;
  videoProducer2: mediasoup.types.Producer;
  audioProducer2: mediasoup.types.Producer | null;
}) {
  if (ffmpegProcess) return; // Already running

  try {
    // helper to create plain transport pair (video port, audio port)
    const createPlainPair = async (videoPort: number, audioPort: number) => {
      const plainV = await mediasoupRouter.createPlainTransport({
        listenIp: { ip: "127.0.0.1" },
        rtcpMux: false,
        comedia: false,
      });
      await plainV.connect({ ip: "127.0.0.1", port: videoPort, rtcpPort: videoPort + 1 });

      const plainA = await mediasoupRouter.createPlainTransport({
        listenIp: { ip: "127.0.0.1" },
        rtcpMux: false,
        comedia: false,
      });
      await plainA.connect({ ip: "127.0.0.1", port: audioPort, rtcpPort: audioPort + 1 });

      return { plainV, plainA };
    };

    // choose ports (adjust if needed)
    const pair1 = await createPlainPair(5004, 5008);
    const pair2 = await createPlainPair(5006, 5010);

    // consume video producers
    const ffmpegVideoConsumer1 = await pair1.plainV.consume({
      producerId: videoProducer1.id,
      rtpCapabilities: mediasoupRouter.rtpCapabilities,
      paused: false,
    });
    const ffmpegVideoConsumer2 = await pair2.plainV.consume({
      producerId: videoProducer2.id,
      rtpCapabilities: mediasoupRouter.rtpCapabilities,
      paused: false,
    });

    // consume audio producers if provided
    let ffmpegAudioConsumer1: typeof ffmpegVideoConsumer1 | null = null;
    let ffmpegAudioConsumer2: typeof ffmpegVideoConsumer1 | null = null;

    if (audioProducer1) {
      ffmpegAudioConsumer1 = await pair1.plainA.consume({
        producerId: audioProducer1.id,
        rtpCapabilities: mediasoupRouter.rtpCapabilities,
        paused: false,
      });
    }
    if (audioProducer2) {
      ffmpegAudioConsumer2 = await pair2.plainA.consume({
        producerId: audioProducer2.id,
        rtpCapabilities: mediasoupRouter.rtpCapabilities,
        paused: false,
      });
    }

    // request keyframes periodically to help ffmpeg decoders sync
    const requestSyncKeyframes = () => {
      try { ffmpegVideoConsumer1.requestKeyFrame(); } catch (e) {}
      try { ffmpegVideoConsumer2.requestKeyFrame(); } catch (e) {}
    };
    requestSyncKeyframes();
    const kfInterval = setInterval(requestSyncKeyframes, 2000);

    const vCodec1 = ffmpegVideoConsumer1.rtpParameters.codecs[0];
    const vCodec2 = ffmpegVideoConsumer2.rtpParameters.codecs[0];
    const aCodec1 = ffmpegAudioConsumer1 ? ffmpegAudioConsumer1.rtpParameters.codecs[0] : null;
    const aCodec2 = ffmpegAudioConsumer2 ? ffmpegAudioConsumer2.rtpParameters.codecs[0] : null;

    // Build SDPs. If audio consumer not present, no m=audio for that input.
    const buildSdp = (videoPort: number, audioPort: number | null, vCodec: any, aCodec: any | null) => {
      let s = `v=0
o=- 0 0 IN IP4 127.0.0.1
s=stream
c=IN IP4 127.0.0.1
t=0 0
m=video ${videoPort} RTP/AVP ${vCodec.payloadType}
a=rtpmap:${vCodec.payloadType} ${vCodec.mimeType.split("/")[1]}/${vCodec.clockRate}
a=recvonly
`;
      if (aCodec && audioPort !== null) {
        s += `m=audio ${audioPort} RTP/AVP ${aCodec.payloadType}
a=rtpmap:${aCodec.payloadType} ${aCodec.mimeType.split("/")[1]}/${aCodec.clockRate}
a=recvonly
`;
      }
      return s;
    };

    const sdp1 = buildSdp(5004, aCodec1 ? 5008 : null, vCodec1, aCodec1);
    const sdp2 = buildSdp(5006, aCodec2 ? 5010 : null, vCodec2, aCodec2);

    fs.writeFileSync("stream1.sdp", sdp1);
    fs.writeFileSync("stream2.sdp", sdp2);

    // Build ffmpeg args: two inputs (video+maybe audio each), scale/hstack videos,
    // resample & amix audio inputs that exist.
    // audio inputs which are missing will be ignored.
    const filterParts: string[] = [];

    // video handling
    filterParts.push("[0:v]setpts=PTS-STARTPTS,fps=30,scale=-1:720,setsar=1[vid1]");
    filterParts.push("[1:v]setpts=PTS-STARTPTS,fps=30,scale=-1:720,setsar=1[vid2]");
    filterParts.push("[vid1][vid2]hstack=inputs=2,scale=trunc(iw/2)*2:trunc(ih/2)*2[outv]");

    // audio handling (0:a and 1:a may or may not exist)
    const audioInputs: string[] = [];
    if (aCodec1) {
      filterParts.push("[0:a]aresample=48000[a0]");
      audioInputs.push("[a0]");
    }
    if (aCodec2) {
      filterParts.push("[1:a]aresample=48000[a1]");
      audioInputs.push("[a1]");
    }

    if (audioInputs.length === 0) {
      // no audio inputs -> leave audio out of mapping
    } else if (audioInputs.length === 1) {
      // only one audio => pass through as aout
      filterParts.push(`${audioInputs[0]}anull[aout]`);
    } else {
      // two audio inputs -> mix them
      filterParts.push(`${audioInputs.join("")}amix=inputs=${audioInputs.length}:dropout_transition=2[aout]`);
    }

    const ffmpegArgs: string[] = [
  "-protocol_whitelist", "file,udp,rtp",
  "-fflags", "+nobuffer",
  "-flags", "low_delay",
  "-max_delay", "500000",
  "-fflags", "+genpts",
  "-loglevel", "debug",
  "-probesize", "32",
  "-analyzeduration", "0",

  "-thread_queue_size", "512",
  "-f", "sdp",
  "-i", "stream1.sdp",

  "-thread_queue_size", "512",
  "-protocol_whitelist", "file,udp,rtp",
  // removed -itsoffset here, assuming sync
  "-f", "sdp",
  "-i", "stream2.sdp",

  "-filter_complex",
  filterParts.join(";"),
  "-map", "[outv]",
];

if (audioInputs.length > 0) {
  ffmpegArgs.push("-map", "[aout]");
  ffmpegArgs.push("-c:a", "aac", "-b:a", "128k", "-ac", "2");
}

ffmpegArgs.push(
  "-c:v", "libx264",
  "-preset", "veryfast",
  "-tune", "zerolatency",
  "-r", "30",
  "-g", "60",
  "-keyint_min", "60",
  "-sc_threshold", "0",
  "-f", "hls",
  "-hls_time", "1",
  "-hls_list_size", "3",
  "-hls_flags", "delete_segments+round_durations+independent_segments+append_list+discont_start+program_date_time",
  "public/stream.m3u8"
);

    ffmpegProcess = spawn("ffmpeg", ffmpegArgs, { stdio: "pipe" });

    ffmpegProcess.stdout?.on("data", (data: Buffer) => {
      console.log(`FFmpeg stdout: ${data.toString()}`);
    });
    ffmpegProcess.stderr?.on("data", (data: Buffer) => {
      console.log(`FFmpeg stderr: ${data.toString()}`);
    });

    ffmpegProcess.on("close", (code: number) => {
      console.log(`FFmpeg process exited with code ${code}`);
      ffmpegProcess = null;
      clearInterval(kfInterval);
    });

    ffmpegProcess.on("error", (error: Error) => {
      console.error("FFmpeg error:", error);
      ffmpegProcess = null;
      clearInterval(kfInterval);
    });

    console.log("FFmpeg streaming started (video+audio where available)");
  } catch (error) {
    console.error("Error starting FFmpeg streaming:", error);
    if (ffmpegProcess) {
      ffmpegProcess.kill();
      ffmpegProcess = null;
    }
  }
}


app.use("/public", express.static("public"));
// Health check endpoint
app.get("/health", (req, res) => {
  res.json({
    status: "OK",
    activeProducers: producers.size,
    activeClients: clients.size,
    hlsFileExists: fs.existsSync("public/stream.m3u8"),
  });
});

// Process cleanup on exit
process.on("SIGINT", () => {
  console.log("🛑 Shutting down server...");

  process.exit();
});

process.on("SIGTERM", () => {
  console.log("🛑 Shutting down server...");

  process.exit();
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📡 WebSocket server ready`);
  console.log(`📺 Watch page: http://localhost:${PORT}/watch`);
  console.log(`💊 Health check: http://localhost:${PORT}/health`);
});
