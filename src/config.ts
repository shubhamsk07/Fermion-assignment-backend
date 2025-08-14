import { RtpCodecCapability } from "mediasoup-client/lib/RtpParameters"
import { TransportListenIp, WorkerLogTag } from "mediasoup/node/lib/types"
import os from "os"

export const config = {
    listenIp: '0.0.0.0',
    listenPort: 3016,

    mediasoup:{
        numWorkers: Object.keys(os.cpus()).length,
        worker:{
            rtcMinPort:10000,
            rtcMaxPort:10100,
            logLevel: 'debug',
            logTags:[
                'info',
                'ice',
                'dlts',
                'rtp',
                'srtp',
                'rtcp',
            ] as WorkerLogTag[]
        },
        router:{
            mediaCodes:[
                {
                    kind:'audio',
                    mimeType:'audio/opus',
                    clockRate:48000,
                    channels:2
                },
                {
                    kind:'video',
                    mimeType:'video/VP8',
                    clockRate:90000,
                    parameters:{
                        'x-google-start-bitrate':1000
                    }
                },
            ] as RtpCodecCapability[]
        },
        // webrtc transport settings
        webRtcTansport:{
           listenIps:[
            {
                ip:'0.0.0.0',
                announcedIp: '192.168.1.7'
            },
           ] as TransportListenIp[],
           maxIncomeBitrate:1500000,
           initialAvailableOutgoingBitrate:1000000

        },
        plainTransportOptions :
		{
			listenInfo :
			{
				protocol         : 'udp',
				ip               : process.env.MEDIASOUP_LISTEN_IP || '0.0.0.0',
				announcedAddress : '127.0.0.1',
				portRange        :
				{
					min : process.env.MEDIASOUP_MIN_PORT || 40000,
					max : process.env.MEDIASOUP_MAX_PORT || 49999,
				}
			},
			maxSctpMessageSize : 262144
		}
    }

}