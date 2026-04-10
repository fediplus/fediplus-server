import type {
  Router,
  WebRtcTransport,
  DtlsParameters,
} from "mediasoup/types";
import { config } from "../config.js";

export interface IceServer {
  urls: string | string[];
  username?: string;
  credential?: string;
}

export interface TransportParams {
  id: string;
  iceParameters: WebRtcTransport["iceParameters"];
  iceCandidates: WebRtcTransport["iceCandidates"];
  dtlsParameters: WebRtcTransport["dtlsParameters"];
  iceServers: IceServer[];
}

export async function createWebRtcTransport(
  router: Router
): Promise<{ transport: WebRtcTransport; params: TransportParams }> {
  const transport = await router.createWebRtcTransport({
    listenInfos: [
      {
        protocol: "udp",
        ip: config.mediasoup.listenIp,
        announcedAddress: config.mediasoup.announcedIp || undefined,
      },
      {
        protocol: "tcp",
        ip: config.mediasoup.listenIp,
        announcedAddress: config.mediasoup.announcedIp || undefined,
      },
    ],
    enableUdp: true,
    enableTcp: true,
    preferUdp: true,
  });

  const iceServers: IceServer[] = [];

  // Always include a STUN server for NAT traversal
  iceServers.push({ urls: "stun:stun.l.google.com:19302" });

  // Add TURN server if configured (required for Cloudflare Tunnel / strict NAT)
  if (config.turn.urls) {
    iceServers.push({
      urls: config.turn.urls.split(",").map((u) => u.trim()),
      username: config.turn.username,
      credential: config.turn.credential,
    });
  }

  const params: TransportParams = {
    id: transport.id,
    iceParameters: transport.iceParameters,
    iceCandidates: transport.iceCandidates,
    dtlsParameters: transport.dtlsParameters,
    iceServers,
  };

  return { transport, params };
}

export async function connectTransport(
  transport: WebRtcTransport,
  dtlsParameters: DtlsParameters
): Promise<void> {
  await transport.connect({ dtlsParameters });
}
