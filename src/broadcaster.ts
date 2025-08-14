// import { Router, Consumer, Producer } from "mediasoup/node/lib/types";
// import { PlainTransport } from "mediasoup/node/lib/PlainTransportTypes";
// import { spawn, ChildProcess } from "child_process";
// import fs from "fs";
// import path from "path";
// import { StreamingSession } from "./types";

// export class RoomBroadcaster {
//   private router: Router;
//   private activeStreams = new Map<string, StreamingSession>();
//   private basePort = 5000;

//   constructor(router: Router) {
//     this.router = router;
//     this.ensureDirectories();
//   }

//   private ensureDirectories() {
//     // Create necessary directories
//     if (!fs.existsSync('./public')) {
//       fs.mkdirSync('./public', { recursive: true });
//     }
//     if (!fs.existsSync('./public/streams')) {
//       fs.mkdirSync('./public/streams', { recursive: true });
//     }
//     if (!fs.existsSync('./tmp')) {
//       fs.mkdirSync('./tmp', { recursive: true });
//     }
//   }

//   async startBroadcast(
//     roomId: string,
//     videoProducers: Producer[],
//     audioProducers: Producer[]
//   ): Promise<boolean> {
//     try {
//       console.log(`Starting broadcast for room ${roomId} with ${videoProducers.length} video and ${audioProducers.length} audio producers`);

//       // Stop existing broadcast if any
//       if (this.activeStreams.has(roomId)) {
//         await this.stopBroadcast(roomId);
//       }

//       // Create plain transport for RTP output
//       const plainTransport = await this.router.createPlainTransport({
//         listenIp: { ip: '127.0.0.1', announcedIp: null },
//         rtcpMux: false,
//         comedia: false,
//         enableUdp: true,
//         enableTcp: false,
//         portRange: { min: this.basePort, max: this.basePort + 100 }
//       });

//       const consumers: Consumer[] = [];
//       let portOffset = 0;

//       // Create consumers for video producers
//       for (const producer of videoProducers) {
//         const consumer = await plainTransport.consume({
//           producerId: producer.id,
//           rtpCapabilities: this.router.rtpCapabilities,
//           paused: false
//         });
//         consumers.push(consumer);

//         // Connect transport for this consumer
//         await plainTransport.connect({
//           ip: '127.0.0.1',
//           port: this.basePort + portOffset
//         });
//         portOffset += 2;
//       }

//       // Create consumers for audio producers
//       for (const producer of audioProducers) {
//         const consumer = await plainTransport.consume({
//           producerId: producer.id,
//           rtpCapabilities: this.router.rtpCapabilities,
//           paused: false
//         });
//         consumers.push(consumer);

//         await plainTransport.connect({
//           ip: '127.0.0.1',
//           port: this.basePort + portOffset
//         });
//         portOffset += 2;
//       }

//       // Start FFmpeg process
//       const ffmpegProcess = this.startFFmpegProcess(roomId, consumers, videoProducers.length, audioProducers.length);

//       // Store session
//       this.activeStreams.set(roomId, {
//         plainTransport,
//         consumers,
//         ffmpegProcess
//       });

//       console.log(`Broadcast started successfully for room ${roomId}`);
//       return true;

//     } catch (error) {
//       console.error(`Error starting broadcast for room ${roomId}:`, error);
//       return false;
//     }
//   }

//   private startFFmpegProcess(
//     roomId: string,
//     consumers: Consumer[],
//     videoCount: number,
//     audioCount: number
//   ): ChildProcess {
//     // Separate consumers by type
//     const videoConsumers = consumers.filter(c => c.kind === 'video');
//     const audioConsumers = consumers.filter(c => c.kind === 'audio');

//     const ffmpegArgs: string[] = [
//       '-y', // Overwrite output files
//       '-loglevel', 'warning',
//       '-protocol_whitelist', 'file,udp,rtp'
//     ];

//     let portIndex = 0;

//     // Add video inputs
//     videoConsumers.forEach((consumer, index) => {
//       const port = this.basePort + (portIndex * 2);
//       const sdp = this.generateVideoSdp(consumer, port);
//       const sdpPath = path.join('./tmp', `video_${roomId}_${index}.sdp`);
//       fs.writeFileSync(sdpPath, sdp);
//       ffmpegArgs.push('-i', sdpPath);
//       portIndex++;
//     });

//     // Add audio inputs
//     audioConsumers.forEach((consumer, index) => {
//       const port = this.basePort + (portIndex * 2);
//       const sdp = this.generateAudioSdp(consumer, port);
//       const sdpPath = path.join('./tmp', `audio_${roomId}_${index}.sdp`);
//       fs.writeFileSync(sdpPath, sdp);
//       ffmpegArgs.push('-i', sdpPath);
//       portIndex++;
//     });

//     // Video processing
//     if (videoConsumers.length === 1) {
//       // Single video - full screen
//       ffmpegArgs.push(
//         '-map', '0:v',
//         '-c:v', 'libx264',
//         '-preset', 'veryfast',
//         '-tune', 'zerolatency',
//         '-profile:v', 'baseline',
//         '-pix_fmt', 'yuv420p'
//       );
//     } else if (videoConsumers.length === 2) {
//       // Two videos - side by side
//       ffmpegArgs.push(
//         '-filter_complex', '[0:v]scale=640:360[left];[1:v]scale=640:360[right];[left][right]hstack=inputs=2[v]',
//         '-map', '[v]',
//         '-c:v', 'libx264',
//         '-preset', 'veryfast',
//         '-tune', 'zerolatency',
//         '-profile:v', 'baseline',
//         '-pix_fmt', 'yuv420p'
//       );
//     } else if (videoConsumers.length > 2) {
//       // Grid layout for more than 2 videos
//       const gridFilter = this.buildGridFilter(videoConsumers.length);
//       ffmpegArgs.push(
//         '-filter_complex', gridFilter,
//         '-map', '[v]',
//         '-c:v', 'libx264',
//         '-preset', 'veryfast',
//         '-tune', 'zerolatency',
//         '-profile:v', 'baseline',
//         '-pix_fmt', 'yuv420p'
//       );
//     }

//     // Audio processing
//     if (audioConsumers.length === 1) {
//       ffmpegArgs.push(
//         '-map', `${videoConsumers.length}:a`,
//         '-c:a', 'aac',
//         '-b:a', '128k',
//         '-ar', '48000'
//       );
//     } else if (audioConsumers.length > 1) {
//       const audioInputs = audioConsumers.map((_, i) => `[${videoConsumers.length + i}:a]`).join('');
//       ffmpegArgs.push(
//         '-filter_complex', `${audioInputs}amix=inputs=${audioConsumers.length}[a]`,
//         '-map', '[a]',
//         '-c:a', 'aac',
//         '-b:a', '128k',
//         '-ar', '48000'
//       );
//     }

//     // Create output directory
//     const outputDir = path.join('./public/streams', roomId);
//     if (!fs.existsSync(outputDir)) {
//       fs.mkdirSync(outputDir, { recursive: true });
//     }

//     // HLS output settings
//     ffmpegArgs.push(
//       '-f', 'hls',
//       '-hls_time', '2',
//       '-hls_list_size', '3',
//       '-hls_flags', 'delete_segments',
//       '-hls_segment_filename', path.join(outputDir, 'segment_%03d.ts'),
//       path.join(outputDir, 'playlist.m3u8')
//     );

//     console.log('Starting FFmpeg with args:', ffmpegArgs.join(' '));

//     const ffmpegProcess = spawn('ffmpeg', ffmpegArgs);

//     ffmpegProcess.stdout.on('data', (data) => {
//       console.log(`FFmpeg ${roomId} stdout:`, data.toString());
//     });

//     ffmpegProcess.stderr.on('data', (data) => {
//       console.log(`FFmpeg ${roomId} stderr:`, data.toString());
//     });

//     ffmpegProcess.on('close', (code) => {
//       console.log(`FFmpeg process for room ${roomId} exited with code ${code}`);
//     });

//     ffmpegProcess.on('error', (error) => {
//       console.error(`FFmpeg process error for room ${roomId}:`, error);
//     });

//     return ffmpegProcess;
//   }

//   private buildGridFilter(videoCount: number): string {
//     if (videoCount <= 4) {
//       // 2x2 grid
//       return `
//         [0:v]scale=640:360[v0];
//         [1:v]scale=640:360[v1];
//         [2:v]scale=640:360[v2];
//         [3:v]scale=640:360[v3];
//         [v0][v1]hstack=inputs=2[row1];
//         [v2][v3]hstack=inputs=2[row2];
//         [row1][row2]vstack=inputs=2[v]
//       `.replace(/\s+/g, '');
//     } else {
//       // Simple fallback for more videos
//       return '[0:v]scale=1280:720[v]';
//     }
//   }

//   private generateVideoSdp(consumer: Consumer, port: number): string {
//     const codec = consumer.rtpParameters.codecs[0];

//     return `v=0
// o=- 0 0 IN IP4 127.0.0.1
// s=Video Stream
// c=IN IP4 127.0.0.1
// t=0 0
// m=video ${port} RTP/AVP ${codec.payloadType}
// a=rtpmap:${codec.payloadType} ${codec.mimeType.split('/')[1]}/${codec.clockRate}
// a=sendonly`;
//   }

//   private generateAudioSdp(consumer: Consumer, port: number): string {
//     const codec = consumer.rtpParameters.codecs[0];

//     return `v=0
// o=- 0 0 IN IP4 127.0.0.1
// s=Audio Stream
// c=IN IP4 127.0.0.1
// t=0 0
// m=audio ${port} RTP/AVP ${codec.payloadType}
// a=rtpmap:${codec.payloadType} ${codec.mimeType.split('/')[1]}/${codec.clockRate}${codec.channels > 1 ? '/' + codec.channels : ''}
// a=sendonly`;
//   }

//   async stopBroadcast(roomId: string): Promise<void> {
//     const session = this.activeStreams.get(roomId);
//     if (!session) {
//       return;
//     }

//     console.log(`Stopping broadcast for room ${roomId}`);

//     // Stop FFmpeg process
//     if (session.ffmpegProcess) {
//       session.ffmpegProcess.kill('SIGTERM');
//     }

//     // Close consumers
//     session.consumers.forEach(consumer => {
//       consumer.close();
//     });

//     // Close transport
//     session.plainTransport.close();

//     // Clean up files
//     try {
//       const outputDir = path.join('./public/streams', roomId);
//       if (fs.existsSync(outputDir)) {
//         fs.rmSync(outputDir, { recursive: true, force: true });
//       }
//     } catch (error) {
//       console.error(`Error cleaning up files for room ${roomId}:`, error);
//     }

//     this.activeStreams.delete(roomId);
//     console.log(`Broadcast stopped for room ${roomId}`);
//   }

//   isStreaming(roomId: string): boolean {
//     return this.activeStreams.has(roomId);
//   }

//   async stopAllBroadcasts(): Promise<void> {
//     const promises = Array.from(this.activeStreams.keys()).map(roomId =>
//       this.stopBroadcast(roomId)
//     );
//     await Promise.all(promises);
//   }
// }