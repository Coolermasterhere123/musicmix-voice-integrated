export function useVoiceAssistant(player:any){
  const speak=(text:string)=>{
    if(typeof window!=='undefined'){
      speechSynthesis.speak(new SpeechSynthesisUtterance(text));
    }
  };
  return {speak};
}
