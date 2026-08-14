import express from "express";
import TravelService from "../services/travelService.js";
import { createResponseStream } from "../utils/streamUtils.js";
import { LogStreamCallbackHandler } from "@langchain/core/tracers/log_stream";

const router = express.Router()
const travelService = new TravelService()

router.post('/recommend',async (req,res) => {
    const { city,budget,days } = req.body
    if(!city || !budget || !days) {
        return res.status(400).json({
            success:false,
            message:'缺少必要参数'
        })
    }
    const response = await travelService.recommend(city, budget, days)
    return res.json({
        success:true,
        data:response
    })

})

router.post('/chat',async (req,res) => {
    const { message } = req.body
    if(!message) {
        return res.status(400).json({
            success:false,
            message:'缺少必要参数'
        })
    }
    //sse 流式接口返回处理
    const responseStream = createResponseStream(res)
    const result = await travelService.chat(message,(chunk) => {
        responseStream.send({ type:'chunk', content:chunk})
    })
    responseStream.send({type: 'complete', data:result})
    responseStream.end()
        
})

export default router