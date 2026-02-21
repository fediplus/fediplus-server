import type {
  Router,
  WebRtcTransport,
  DtlsParameters,
} from "mediasoup/types";
import { config } from "../config.js";

export interface TransportParams {
  id: string;
  iceParameters: WebRtcTransport["iceParameters"];
  iceCandidates: WebRtcTransport["iceCandidates"];
  dtlsParameters: WebRtcTransport["dtlsParameters"];
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

  const params: TransportParams = {
    id: transport.id,
    iceParameters: transport.iceParameters,
    iceCandidates: transport.iceCandidates,
    dtlsParameters: transport.dtlsParameters,
  };

  return { transport, params };
}

export async function connectTransport(
  transport: WebRtcTransport,
  dtlsParameters: DtlsParameters
): Promise<void> {
  await transport.connect({ dtlsParameters });
}
