import { WebSocket } from "ws";
import { Transport, Producer, Consumer, PlainTransport } from "mediasoup/node/lib/types";
import { ChildProcess } from "child_process";

export interface ClientData {
  ws: WebSocket;
  producerTransport?: Transport;
  consumerTransport?: Transport;
  producer?: Producer;
  consumers: Map<string, Consumer>;
  roomId?: string;
  peerId?: string;
}

export interface RoomState {
  participants: Set<string>;
  videoProducers: Map<string, Producer>;
  audioProducers: Map<string, Producer>;
  isStreaming: boolean;
}

export interface StreamingSession {
  plainTransport: PlainTransport;
  consumers: Consumer[];
  ffmpegProcess?: ChildProcess;
}

export interface WebSocketMessage {
  type: string;
  [key: string]: any;
}