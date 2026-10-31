function localEndpoint(value){const url=new URL(value);if(url.protocol!=='http:'||!['127.0.0.1','localhost','[::1]'].includes(url.hostname)||url.username||url.password||url.search||url.hash)throw Error('Local voice endpoint must be a loopback HTTP URL');return url.href.replace(/\/+$/,'');}
export function createVoiceClient({baseUrl='http://127.0.0.1:18933/v1',token,allowNoAuth=false,speechModel='local-tts',transcriptionModel='local-asr',defaultVoice='default',fetcher=fetch}){
  const endpoint=localEndpoint(baseUrl);
  if((typeof token!=='string'||!token)&&!allowNoAuth)throw Error('A local voice token is required');
  async function request(route,body,signal){
    const response=await fetcher(endpoint+route,{method:'POST',headers:{...(token?{Authorization:'Bearer '+token}:{}),...(body instanceof FormData?{}:{'Content-Type':'application/json'})},body:body instanceof FormData?body:JSON.stringify(body),redirect:'error',signal:AbortSignal.any([AbortSignal.timeout(180000),...(signal?[signal]:[])])});
    if(!response.ok){let code='voice_request_failed';try{code=(await response.json()).error?.code??code;}catch{}throw Error(`Local voice ${response.status}: ${code}`);}
    return response;
  }
  return Object.freeze({version:1,endpoint,
    async synthesize(text,{voice=defaultVoice,format='wav',emotion,signal}={}){const response=await request('/audio/speech',{model:speechModel,input:text,voice,response_format:format,...(emotion===undefined?{}:{emotion})},signal),audio=Buffer.from(await response.arrayBuffer());if(format==='wav'&&audio.subarray(0,4).toString()!=='RIFF'||format==='mp3'&&audio.subarray(0,3).toString()!=='ID3'&&!(audio[0]===255&&(audio[1]&224)===224))throw Error('Local speech server returned a different audio format');let segments=[];try{segments=JSON.parse(Buffer.from(response.headers.get('x-voice-segments')??'','base64url').toString());if(!Array.isArray(segments))segments=[];}catch{}return {audio,format,contentType:response.headers.get('content-type'),emotion:response.headers.get('x-voice-emotion')??'neutral',segments};},
    async transcribe(audio,{filename='voice.wav',language='zh',signal}={}){const form=new FormData();form.set('model',transcriptionModel);form.set('language',language);form.set('response_format','json');form.set('file',new Blob([audio]),filename);return (await request('/audio/transcriptions',form,signal)).json();}
  });
}
