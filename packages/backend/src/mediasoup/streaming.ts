import { spawn, type ChildProcess } from "node:child_process";
import type { PlainTransport } from "mediasoup/types";
import { getRoom } from "./rooms.js";

interface StreamProcess {
  ffmpeg: ChildProcess;
  audioTransport?: PlainTransport;
  videoTransport?: PlainTransport;
}

const activeStreams = new Map<string, StreamProcess>();

export async function startRtmpStream(
  hangoutId: string,
  rtmpUrl: string
): Promise<boolean> {
  const room = getRoom(hangoutId);
  if (!room) return false;

  // Don't start if already streaming
  if (activeStreams.has(hangoutId)) return false;

  const router = room.router;

  // Find first audio and video producer in the room
  let audioProducer;
  let videoProducer;

  for (const participant of room.participants.values()) {
    for (const producer of participant.producers.values()) {
      if (producer.kind === "audio" && !audioProducer) {
        audioProducer = producer;
      }
      if (producer.kind === "video" && !videoProducer) {
        videoProducer = producer;
      }
    }
    if (audioProducer && videoProducer) break;
  }

  if (!audioProducer && !videoProducer) {
    return false;
  }

  const streamProcess: StreamProcess = {
    ffmpeg: null as unknown as ChildProcess,
  };

  let audioPort: number | undefined;
  let videoPort: number | undefined;

  // Create plain transport for audio and consume the audio producer
  if (audioProducer) {
    const audioTransport = await router.createPlainTransport({
      listenInfo: {
        protocol: "udp",
        ip: "127.0.0.1",
      },
      rtcpMux: false,
      comedia: true,
    });

    await audioTransport.consume({
      producerId: audioProducer.id,
      rtpCapabilities: router.rtpCapabilities,
      paused: false,
    });

    audioPort = audioTransport.tuple.localPort;
    streamProcess.audioTransport = audioTransport;
  }

  // Create separate plain transport for video
  if (videoProducer) {
    const videoTransport = await router.createPlainTransport({
      listenInfo: {
        protocol: "udp",
        ip: "127.0.0.1",
      },
      rtcpMux: false,
      comedia: true,
    });

    await videoTransport.consume({
      producerId: videoProducer.id,
      rtpCapabilities: router.rtpCapabilities,
      paused: false,
    });

    videoPort = videoTransport.tuple.localPort;
    streamProcess.videoTransport = videoTransport;
  }

  // Build FFmpeg command with SDP input
  const ffmpegArgs: string[] = [
    "-protocol_whitelist",
    "pipe,udp,rtp",
    "-f",
    "sdp",
    "-i",
    "pipe:0",
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-tune",
    "zerolatency",
    "-c:a",
    "aac",
    "-ar",
    "44100",
    "-b:a",
    "128k",
    "-f",
    "flv",
    rtmpUrl,
  ];

  const ffmpeg = spawn("ffmpeg", ffmpegArgs, {
    stdio: ["pipe", "pipe", "pipe"],
  });

  ffmpeg.on("error", (err) => {
    console.error(`FFmpeg error for hangout ${hangoutId}:`, err.message);
    stopRtmpStream(hangoutId);
  });

  ffmpeg.on("close", (code) => {
    console.log(`FFmpeg exited with code ${code} for hangout ${hangoutId}`);
    activeStreams.delete(hangoutId);
  });

  // Write SDP to FFmpeg stdin
  const sdpLines = [
    "v=0",
    "o=- 0 0 IN IP4 127.0.0.1",
    "s=Hangout Stream",
    "c=IN IP4 127.0.0.1",
    "t=0 0",
  ];

  if (audioPort) {
    sdpLines.push(
      `m=audio ${audioPort} RTP/AVP 111`,
      "a=rtpmap:111 opus/48000/2",
      "a=fmtp:111 minptime=10;useinbandfec=1"
    );
  }

  if (videoPort) {
    sdpLines.push(
      `m=video ${videoPort} RTP/AVP 96`,
      "a=rtpmap:96 VP8/90000"
    );
  }

  ffmpeg.stdin?.write(sdpLines.join("\r\n") + "\r\n");
  ffmpeg.stdin?.end();

  streamProcess.ffmpeg = ffmpeg;
  activeStreams.set(hangoutId, streamProcess);

  return true;
}

export function stopRtmpStream(hangoutId: string): boolean {
  const stream = activeStreams.get(hangoutId);
  if (!stream) return false;

  try {
    stream.ffmpeg.kill("SIGTERM");
  } catch {
    // Process may already be dead
  }

  try {
    stream.audioTransport?.close();
  } catch {
    // Transport may already be closed
  }

  try {
    stream.videoTransport?.close();
  } catch {
    // Transport may already be closed
  }

  activeStreams.delete(hangoutId);

  // Also clean up the room's plain transport reference
  const room = getRoom(hangoutId);
  if (room) {
    room.plainTransport = undefined;
  }

  return true;
}

export function isStreaming(hangoutId: string): boolean {
  return activeStreams.has(hangoutId);
}
