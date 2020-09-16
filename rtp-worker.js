
var stats = require('./statistics')
var dgram = require('dgram'); 

var inter_packet_stats = new stats()
var delay_stats = new stats()
var rms = [new stats(), new stats()]
const { parentPort , workerData } = require('worker_threads')

console.log(workerData)

let timeOffset = 0n

let interval = 0.05,
    sampleRate = 48000,
    bytePerSample = 4,
    bytePerSampleStream = 3,
    channels = 2

  let buffer = [
    new Buffer.alloc(interval*sampleRate* bytePerSample * channels),
    new Buffer.alloc(interval*sampleRate* bytePerSample * channels)
  ]

  //console.log(buffer)

  let currentBuffer = 0
  let currentPos = 0

  var client = null

var getRtp = (params) => {
    console.log(params)
    let madd = params.maddress
    let port = params.port
    let host = params.host
    channels = params.channels

    let mix = []

    for(let g = 0 ; g < channels ; g++)
        mix[g] = (g%2 == 0)? [1,0] : [0,1]
        //buffer[g] = new Buffer.alloc(interval*sampleRate* bytePerSample * channels)

    for(let c = 0 ; c < channels ; c++)
        rms[c] = new stats()

    // check multi
    let b1 = parseInt(madd.split(".")[0])
    if(b1 < 224 || b1 > 240)
        return

    let offset = params.offset || 0
    client = dgram.createSocket({ type: "udp4", reuseAddr: true });
  
    client.on('listening', function () {
        console.log('UDP Client listening on ' + madd + ":" + port);
        client.setBroadcast(true)
        client.setMulticastTTL(128); 
        client.addMembership(madd,host);
    });
  
    let lastSeq = 0
    let lastTime = BigInt(0)
  
    client.on('message', function (message, remote) {   
        //console.log(".")
        let v = message.readInt8(0)
        let pt = message.readInt8(1)
        let seq = message.readUInt16BE(2)
        let ts = (message.readUInt32BE(4) - offset)%Math.pow(2,32)
        let ssrc = message.readUInt32BE(8)
  
        // inter packet time
        let time = process.hrtime.bigint()
        let diff = Number(time - lastTime)/1000000;
        lastTime = time
  
        // computing ts
        let realTime = timeOffset + time
        let realTS = Number(realTime*48000n / 1000000000n)%Math.pow(2,32)
        let tsdiff = (realTS - ts + Math.pow(2,32))%Math.pow(2,32)
        if(tsdiff > Math.pow(2,31)) tsdiff = tsdiff - Math.pow(2,32)
        inter_packet_stats.add(diff)
        delay_stats.add(tsdiff)
  
  
        if(seq != lastSeq+1)
          console.log("Err Seq: ",seq,lastSeq)
        lastSeq = seq
        if(lastSeq == 65535) lastSeq = -1
        
  
        for(let sampleIndex = 0; sampleIndex < (message.length - 12)/(channels * bytePerSampleStream); sampleIndex++) 
        {
          if(currentPos == interval*sampleRate)
          {
            //console.log("sending " + currentPos + " at " + Date.now())
            currentPos = 0
            let rmsT = [],
                peakT = [],
                peakgT = []

            for(let c = 0 ; c < channels ; c++) {
                rmsT[c] = 10*Math.log10(rms[c].get(true).mean)
                peakT[c] = 10*Math.log10(rms[c].get(true).max)
                peakgT[c] = 10*Math.log10(rms[c].get().max_global)
            }
            parentPort.postMessage({
                type: "data",
                data: {
                    buffer: buffer[currentBuffer],
                    delay: delay_stats.get(),
                    inter_packets: inter_packet_stats.get(),
                    rms: rmsT,
                    peak: peakT,
                    peakg: peakgT,
                    rtp : {
                        payload_type: pt,
                        ssrc: ssrc
                    },
                    sender : {
                        ip: remote.address,
                        port: remote.port
                    }
                }
            })
            currentBuffer = (currentBuffer+1)%2
          }
  
          let s, sL = 0, sR = 0
          for(let c = 0 ; c < channels ; c++) {
            s = (message.readInt32BE(sampleIndex*bytePerSampleStream*channels+12 + bytePerSampleStream*c - 1) & 0x00FFFFFF) << 8
            rms[c].add((s / Math.pow(2,(8*bytePerSample-1)))*(s / Math.pow(2,(8*bytePerSample-1))))
            sL += mix[c][0]* s
            sR += mix[c][1]* s
          }
          buffer[currentBuffer].writeInt32LE(sL,bytePerSample * 2*currentPos)
          buffer[currentBuffer].writeInt32LE(sR,bytePerSample * 2*currentPos + bytePerSample)
          currentPos += 1
        }
    });
  
    client.bind(port);
  }
  


parentPort.on("message",(t) => {
    switch(t.type) {
        case "timeOffset":
            timeOffset = t.data
            break
        case "start":
            getRtp(t.data)
            break
        case "restart":
            if(client) client.close()
            //console.log(t)
            getRtp(t.data)
        case "clear":
            inter_packet_stats.clear()
            delay_stats.clear()
            rms.forEach(e => e.clear())
            break
        default:
            break;
    }
})