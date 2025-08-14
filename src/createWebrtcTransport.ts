import { Router } from "mediasoup/node/lib/RouterTypes";
import { config } from "./config";

const createWebRtcTransport = async(mediasoupRouter:Router)=>{
    const {
        maxIncomeBitrate,
        initialAvailableOutgoingBitrate
    } = config.mediasoup.webRtcTansport

    const transport  = await mediasoupRouter.createWebRtcTransport({
        listenIps:config.mediasoup.webRtcTansport.listenIps,
        enableUdp:true,
        enableTcp:true,
        preferUdp:true,
        initialAvailableOutgoingBitrate,

    })
    if(maxIncomeBitrate){
        try{
            await transport.setMaxIncomingBitrate(maxIncomeBitrate)
        }catch(error){
            console.error(error)
        }
    }

    return {
        transport,
        params:{
            id:transport.id,
            iceParameters:transport.iceParameters,
            iceCandidates  :transport.iceCandidates,
            dtlsParameters:transport.dtlsParameters
        }
    }
}

export {createWebRtcTransport}