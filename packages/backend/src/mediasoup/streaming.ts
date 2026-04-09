import { spawn, type ChildProcess } from "node:child_process";
import type { PlainTransport, Consumer } from "mediasoup/types";
import { getRoom } from "./rooms.js";

interface StreamProcess {
  ffmpeg: ChildProcess;
  audioTransport?: PlainTransport;
  videoTransport?: PlainTransport;
  audioConsumer?: Consumer;
  videoConsumer?: Consumer;
  rtmpUrl: string;
  startedAt: Date;
}

const activeStreams = new Map<string, StreamProcess>();

export async function startRtmpStream(
  hangoutId: string,
  rtmpUrl: string
): Promise<true> {
  const room = getRoom(hangoutId);
  if (!room) {
    throw Object.assign(
      new Error("Media room not found. Try refreshing the page."),
      { statusCode: 404 }
    );
  }

  // Don't start if already streaming
  if (activeStreams.has(hangoutId)) {
    throw Object.assign(
      new Error("A stream is already active for this hangout"),
      { statusCode: 409 }
    );
  }

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
    throw Object.assign(
      new Error(
        "No active audio or video. Make sure at least one participant " +
        "has granted camera or microphone access."
      ),
      { statusCode: 400 }
    );
  }

  const streamProcess: StreamProcess = {
    ffmpeg: null as unknown as ChildProcess,
    rtmpUrl,
    startedAt: new Date(),
  };

  let audioPort: number | undefined;
  let audioRtcpPort: number | undefined;
  let videoPort: number | undefined;
  let videoRtcpPort: number | undefined;

  // Create plain transport for audio and consume the audio producer
  if (audioProducer) {
    const audioTransport = await router.createPlainTransport({
      listenInfo: {
        protocol: "udp",
        ip: "127.0.0.1",
      },
      rtcpMux: false,
      comedia: false,
    });

    const audioConsumer = await audioTransport.consume({
      producerId: audioProducer.id,
      rtpCapabilities: router.rtpCapabilities,
      paused: false,
    });

    audioPort = audioTransport.tuple.localPort;
    audioRtcpPort = audioTransport.rtcpTuple?.localPort;
    streamProcess.audioTransport = audioTransport;
    streamProcess.audioConsumer = audioConsumer;
  }

  // Create separate plain transport for video
  if (videoProducer) {
    const videoTransport = await router.createPlainTransport({
      listenInfo: {
        protocol: "udp",
        ip: "127.0.0.1",
      },
      rtcpMux: false,
      comedia: false,
    });

    const videoConsumer = await videoTransport.consume({
      producerId: videoProducer.id,
      rtpCapabilities: router.rtpCapabilities,
      paused: false,
    });

    videoPort = videoTransport.tuple.localPort;
    videoRtcpPort = videoTransport.rtcpTuple?.localPort;
    streamProcess.videoTransport = videoTransport;
    streamProcess.videoConsumer = videoConsumer;
  }

  // Determine video codec from consumer
  const videoCodecName =
    streamProcess.videoConsumer?.rtpParameters.codecs[0]?.mimeType
      ?.split("/")[1]
      ?.toUpperCase() ?? "VP8";

  // Build SDP content
  const sdpLines = [
    "v=0",
    "o=- 0 0 IN IP4 127.0.0.1",
    "s=Hangout Stream",
    "c=IN IP4 127.0.0.1",
    "t=0 0",
  ];

  if (audioPort) {
    const audioPayload =
      streamProcess.audioConsumer?.rtpParameters.codecs[0]?.payloadType ?? 111;
    const audioClockRate =
      streamProcess.audioConsumer?.rtpParameters.codecs[0]?.clockRate ?? 48000;
    sdpLines.push(
      `m=audio ${audioPort} RTP/AVP ${audioPayload}`,
      `a=rtpmap:${audioPayload} opus/${audioClockRate}/2`,
      `a=fmtp:${audioPayload} minptime=10;useinbandfec=1`
    );
    if (audioRtcpPort) {
      sdpLines.push(`a=rtcp:${audioRtcpPort}`);
    }
  }

  if (videoPort) {
    const videoPayload =
      streamProcess.videoConsumer?.rtpParameters.codecs[0]?.payloadType ?? 96;
    const videoClockRate =
      streamProcess.videoConsumer?.rtpParameters.codecs[0]?.clockRate ?? 90000;
    sdpLines.push(
      `m=video ${videoPort} RTP/AVP ${videoPayload}`,
      `a=rtpmap:${videoPayload} ${videoCodecName}/${videoClockRate}`
    );
    if (videoRtcpPort) {
      sdpLines.push(`a=rtcp:${videoRtcpPort}`);
    }
  }

  // Build FFmpeg args — transcode to H.264 + AAC for RTMP compatibility
  const ffmpegArgs: string[] = [
    "-protocol_whitelist", "pipe,udp,rtp",
    "-fflags", "+genpts",
    "-f", "sdp",
    "-i", "pipe:0",
  ];

  // Video encoding: transcode to H.264 for RTMP
  if (videoPort) {
    ffmpegArgs.push(
      "-c:v", "libx264",
      "-preset", "veryfast",
      "-tune", "zerolatency",
      "-b:v", "2500k",
      "-maxrate", "2500k",
      "-bufsize", "5000k",
      "-pix_fmt", "yuv420p",
      "-g", "60",
      "-r", "30"
    );
  }

  // Audio encoding: transcode to AAC
  if (audioPort) {
    ffmpegArgs.push(
      "-c:a", "aac",
      "-ar", "44100",
      "-b:a", "128k",
      "-ac", "2"
    );
  }

  ffmpegArgs.push("-f", "flv", "-flvflags", "no_duration_filesize", rtmpUrl);

  const ffmpeg = spawn("ffmpeg", ffmpegArgs, {
    stdio: ["pipe", "pipe", "pipe"],
  });

  ffmpeg.on("error", (err) => {
    console.error(`FFmpeg error for hangout ${hangoutId}:`, err.message);
    stopRtmpStream(hangoutId);
  });

  ffmpeg.stderr?.on("data", (data: Buffer) => {
    const msg = data.toString();
    // Log only important messages, not per-frame stats
    if (
      msg.includes("Error") ||
      msg.includes("error") ||
      msg.includes("Stream mapping")
    ) {
      console.log(`FFmpeg [${hangoutId}]: ${msg.trim()}`);
    }
  });

  ffmpeg.on("close", (code) => {
    console.log(`FFmpeg exited with code ${code} for hangout ${hangoutId}`);
    activeStreams.delete(hangoutId);
  });

  // Write SDP to FFmpeg stdin
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
    stream.audioConsumer?.close();
    stream.audioTransport?.close();
  } catch {
    // Transport may already be closed
  }

  try {
    stream.videoConsumer?.close();
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

export function getStreamInfo(hangoutId: string) {
  const stream = activeStreams.get(hangoutId);
  if (!stream) return null;
  return {
    startedAt: stream.startedAt,
    rtmpUrl: stream.rtmpUrl.replace(/\/[^/]+$/, "/****"), // mask stream key
  };
}
