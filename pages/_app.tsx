import '../styles/globals.css'
import type { AppProps } from 'next/app'
import { useState, useEffect, useRef, useCallback, createContext, useContext } from 'react'
import Head from 'next/head'
  
// ─── Types ────────────────────────────────────────────────────────────────────
interface Track {
  id: string; title: string; artist: string; thumbnail?: string
  duration?: string; source: 'youtube'; channel?: string; youtubeId?: string
  playlistId?: string; isMix?: boolean; durationSecs?: number
}
interface PlayerCtx {
  currentTrack: Track|null; queue: Track[]; isPlaying: boolean
  progress: number; currentTime: number; duration: number
  playTrack:(t:Track,list?:Track[])=>void; togglePlay:()=>void
  next:()=>void; prev:()=>void
  addToQueue:(t:Track[])=>void; removeFromQueue:(id:string)=>void
  seek:(pct:number)=>void; shuffle:boolean; toggleShuffle:()=>void
  repeat:'none'|'one'|'all'; cycleRepeat:()=>void
  activeList:Track[]; setActiveList:(t:Track[])=>void
}
const Ctx = createContext<PlayerCtx|null>(null)
const usePlayer = ()=>useContext(Ctx)!

// ─── Genres ───────────────────────────────────────────────────────────────────
const GENRES = [
  { id:'rock',        label:'Rock',         icon:'🎸', color:'#e84393', queries:['rock songs','classic rock hits','rock anthems','best rock music'] },
  { id:'pop',         label:'Pop',          icon:'🌟', color:'#3498db', queries:['pop music hits','popular songs','pop songs 2020s','best pop music'] },
  { id:'metal',       label:'Metal',        icon:'🤘', color:'#e74c3c', queries:['heavy metal songs','metal music','metal hits','best metal bands'] },
  { id:'country',     label:'Country',      icon:'🤠', color:'#f39c12', queries:['country music songs','country hits','best country songs','country music'] },
  { id:'radio',       label:'Radio',        icon:'📻', color:'#00bcd4', queries:[] },
  { id:'alternative', label:'Alternative',  icon:'🌀', color:'#27ae60', queries:['alternative rock','alt rock hits','best alternative songs','indie rock hits'] },
  { id:'classicrock', label:'Classic Rock', icon:'🏟️', color:'#c0392b', queries:['classic rock songs','70s rock music','80s rock hits','classic rock anthems'] },
  { id:'hairnation',  label:'Hair Nation',  icon:'🦁', color:'#ff1493', queries:['80s hair metal','glam metal songs','hair band rock','80s rock ballads hair metal'] },
]

const fmt=(s:number)=>{ if(!s||isNaN(s))return'0:00'; return`${Math.floor(s/60)}:${Math.floor(s%60).toString().padStart(2,'0')}` }

// ─── YouTube IFrame API types ─────────────────────────────────────────────────
declare global {
  interface Window {
    YT: any
    onYouTubeIframeAPIReady: ()=>void
    _swRegistered?: boolean
  }
}

// ─── Player Provider ──────────────────────────────────────────────────────────
function PlayerProvider({children}:{children:React.ReactNode}){
  const [currentTrack,  setCurrentTrack] = useState<Track|null>(null)
  const [queue,         setQueue]         = useState<Track[]>([])
  const [activeList,    setActiveListS]   = useState<Track[]>([])
  const [isPlaying,     setIsPlaying]     = useState(false)
  const [progress,      setProgress]      = useState(0)
  const [currentTime,   setCurrentTime]   = useState(0)
  const [duration,      setDuration]      = useState(0)
  const [shuffle,       setShuffle]       = useState(false)
  const [repeat,        setRepeat]        = useState<'none'|'one'|'all'>('all')
  const [loadingAudio,  setLoadingAudio]  = useState(false)

  const nativeAudio   = useRef<HTMLAudioElement|null>(null)
  const silentAudio   = useRef<HTMLAudioElement|null>(null)
  const ytPlayer      = useRef<any>(null)
  const ytReady       = useRef(false)
  const wakeLock      = useRef<any>(null)
  const currentRef    = useRef<Track|null>(null)
  const listRef       = useRef<Track[]>([])
  const isPlayingRef  = useRef(false)
  const progressInt   = useRef<any>(null)
  const audioModeRef  = useRef<'native'|'iframe'>('native')
  const playInnerRef  = useRef<((t:Track)=>Promise<void>)|null>(null)
  const getNextRef    = useRef<((cur:Track|null)=>Track|null)|null>(null)
  const getPrevRef    = useRef<((cur:Track|null)=>Track|null)|null>(null)

  useEffect(()=>{currentRef.current=currentTrack},[currentTrack])
  useEffect(()=>{listRef.current=activeList},[activeList])
  useEffect(()=>{isPlayingRef.current=isPlaying},[isPlaying])

  const acquireWake=async()=>{
    try{ if('wakeLock' in navigator) wakeLock.current=await (navigator as any).wakeLock.request('screen') }catch{}
  }
  useEffect(()=>{
    const h=()=>{ if(document.visibilityState==='visible'&&isPlayingRef.current) acquireWake() }
    document.addEventListener('visibilitychange',h)
    return()=>document.removeEventListener('visibilitychange',h)
  },[])

  useEffect(()=>{
    if(typeof window==='undefined'||(window as any)._swDone) return
    ;(window as any)._swDone=true
    if('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(()=>{})
  },[])

  // Silent keepalive — keeps MediaSession alive for Bluetooth headunit
  useEffect(()=>{
    if(typeof window==='undefined') return
    const SILENT='data:audio/mpeg;base64,SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjU4LjI5LjEwMAAAAAAAAAAAAAAA//tQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWGluZwAAAA8AAAACAAADkAC2tra2tra2tra2tra2tra2tra2tra2tra2tra2tra2tra2tra2tra2tra2AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
    const audio=new Audio(SILENT)
    audio.loop=true; audio.volume=0.001
    silentAudio.current=audio
    return()=>{ audio.pause() }
  },[])

  // Native audio element — plays direct URL, keeps going on iOS lock screen
  useEffect(()=>{
    if(typeof window==='undefined') return
    const audio=new Audio()
    audio.preload='auto'
    nativeAudio.current=audio
    const onTime=()=>{
      if(audioModeRef.current!=='native') return
      setCurrentTime(audio.currentTime)
      if(audio.duration){ setProgress(audio.currentTime/audio.duration); setDuration(audio.duration) }
    }
    const onEnded=()=>{
      if(audioModeRef.current!=='native') return
      clearInterval(progressInt.current)
      setIsPlaying(false); isPlayingRef.current=false
      const nxt=getNextRef.current?.(currentRef.current)
      if(nxt) setTimeout(()=>playInnerRef.current?.(nxt),300)
    }
    const onError=(e:any)=>{
      if(audioModeRef.current!=='native') return
      console.log('Native audio error, switching to iframe')
      if(currentRef.current) switchToIframeRef.current?.(currentRef.current)
    }
    audio.addEventListener('timeupdate',onTime)
    audio.addEventListener('ended',onEnded)
    audio.addEventListener('error',onError)
    return()=>{ audio.pause() }
  },[]) // eslint-disable-line

  // YouTube IFrame API — fallback when direct audio unavailable
  useEffect(()=>{
    if(typeof window==='undefined') return
    const initPlayer=()=>{
      if(ytPlayer.current) return
      const origin=window.location.origin
      ytPlayer.current=new window.YT.Player('yt-iframe',{
        height:'1',width:'1',
        playerVars:{playsinline:1,controls:0,disablekb:1,fs:0,rel:0,modestbranding:1,origin},
        events:{
          onReady:()=>{ ytReady.current=true },
          onStateChange:(e:any)=>{
            if(audioModeRef.current!=='iframe') return
            const S=window.YT.PlayerState
            if(e.data===S.PLAYING){
              setIsPlaying(true); isPlayingRef.current=true
              const dur=ytPlayer.current?.getDuration?.()||0; setDuration(dur)
              clearInterval(progressInt.current)
              progressInt.current=setInterval(()=>{
                const ct=ytPlayer.current?.getCurrentTime?.()||0
                const d=ytPlayer.current?.getDuration?.()||0
                setCurrentTime(ct); if(d>0) setProgress(ct/d)
              },500)
            } else if(e.data===S.PAUSED){
              setIsPlaying(false); isPlayingRef.current=false
              clearInterval(progressInt.current)
            } else if(e.data===S.ENDED){
              clearInterval(progressInt.current)
              setIsPlaying(false); isPlayingRef.current=false
              const nxt=getNextRef.current?.(currentRef.current)
              if(nxt) setTimeout(()=>playInnerRef.current?.(nxt),300)
            }
          },
          onError:()=>{
            const nxt=getNextRef.current?.(currentRef.current)
            if(nxt) setTimeout(()=>playInnerRef.current?.(nxt),1000)
          }
        }
      })
    }
    if(window.YT?.Player){ initPlayer() }
    else {
      window.onYouTubeIframeAPIReady=initPlayer
      if(!document.getElementById('yt-api-script')){
        const s=document.createElement('script')
        s.id='yt-api-script'; s.src='https://www.youtube.com/iframe_api'; s.async=true
        document.head.appendChild(s)
      }
    }
    return()=>{ clearInterval(progressInt.current) }
  },[]) // eslint-disable-line

  const getNext=useCallback((cur:Track|null)=>{
    const list=listRef.current; if(!list.length) return null
    if(repeat==='one') return cur
    if(shuffle) return list[Math.floor(Math.random()*list.length)]
    const i=list.findIndex(t=>t.id===cur?.id)
    if(i===-1) return list[0]
    const ni=i+1; return ni>=list.length?(repeat==='all'?list[0]:null):list[ni]
  },[shuffle,repeat])

  const getPrev=useCallback((cur:Track|null)=>{
    const list=listRef.current; if(!list.length) return null
    const i=list.findIndex(t=>t.id===cur?.id)
    return i<=0?list[list.length-1]:list[i-1]
  },[])

  useEffect(()=>{ getNextRef.current=getNext },[getNext])
  useEffect(()=>{ getPrevRef.current=getPrev },[getPrev])

  const updateMediaSession=useCallback((track:Track,playing:boolean)=>{
    if(typeof window==='undefined'||!('mediaSession' in navigator)) return
    navigator.mediaSession.metadata=new MediaMetadata({
      title:track.title,artist:track.artist,album:'SonicWave',
      artwork:track.thumbnail?[{src:track.thumbnail,sizes:'480x360',type:'image/jpeg'}]:[]
    })
    navigator.mediaSession.playbackState=playing?'playing':'paused'
  },[])

  const switchToIframeRef=useRef<((t:Track)=>void)|null>(null)
  const switchToIframe=useCallback((track:Track)=>{
    audioModeRef.current='iframe'
    nativeAudio.current?.pause()
    const vid=track.youtubeId||track.id
    if(ytReady.current&&ytPlayer.current?.loadVideoById) ytPlayer.current.loadVideoById(vid)
  },[])
  useEffect(()=>{ switchToIframeRef.current=switchToIframe },[switchToIframe])

  // Main play function — tries native audio first, falls back to iframe
  const playTrackInner=useCallback(async(track:Track)=>{
    const vid=track.youtubeId||track.id
    setCurrentTrack(track); currentRef.current=track
    setProgress(0); setCurrentTime(0); setDuration(0)
    setIsPlaying(true); isPlayingRef.current=true
    setLoadingAudio(true)
    acquireWake()
    updateMediaSession(track,true)
    nativeAudio.current?.pause()
    if(audioModeRef.current==='iframe') ytPlayer.current?.pauseVideo?.()
    clearInterval(progressInt.current)

    // Try direct audio URL (works in background on iOS)
    try{
      const resp=await fetch(`/api/yt-audio?videoId=${vid}`)
      if(resp.ok){
        const data=await resp.json()
        if(data.audioUrl&&!data.error){
          const audio=nativeAudio.current!
          audio.src=data.audioUrl
          audio.load()
          audioModeRef.current='native'
          await audio.play()
          silentAudio.current?.play().catch(()=>{})
          setLoadingAudio(false)
          return
        }
      }
    }catch(e){ console.log('yt-audio failed, using iframe fallback') }

    // Fallback to iframe
    setLoadingAudio(false)
    switchToIframe(track)
    silentAudio.current?.play().catch(()=>{})
  },[updateMediaSession,switchToIframe])

  useEffect(()=>{ playInnerRef.current=playTrackInner },[playTrackInner])

  const playTrack=useCallback((track:Track,list?:Track[])=>{
    if(list){ setActiveListS(list); listRef.current=list }
    playTrackInner(track)
  },[playTrackInner])

  const next=useCallback(()=>{ const t=getNext(currentRef.current); if(t) playTrackInner(t) },[getNext,playTrackInner])
  const prev=useCallback(()=>{ const t=getPrev(currentRef.current); if(t) playTrackInner(t) },[getPrev,playTrackInner])

  const togglePlay=useCallback(()=>{
    if(audioModeRef.current==='native'){
      const audio=nativeAudio.current!
      if(isPlayingRef.current){ audio.pause(); silentAudio.current?.pause(); setIsPlaying(false); isPlayingRef.current=false }
      else{ audio.play().catch(()=>{}); silentAudio.current?.play().catch(()=>{}); setIsPlaying(true); isPlayingRef.current=true }
    } else {
      if(isPlayingRef.current){ ytPlayer.current?.pauseVideo?.(); silentAudio.current?.pause(); setIsPlaying(false); isPlayingRef.current=false }
      else{ ytPlayer.current?.playVideo?.(); silentAudio.current?.play().catch(()=>{}); setIsPlaying(true); isPlayingRef.current=true }
    }
  },[])

  const seek=useCallback((pct:number)=>{
    if(audioModeRef.current==='native'){
      const audio=nativeAudio.current
      if(audio?.duration){ audio.currentTime=pct*audio.duration; setProgress(pct); setCurrentTime(pct*audio.duration) }
    } else {
      const dur=ytPlayer.current?.getDuration?.()||duration
      if(dur>0){ ytPlayer.current?.seekTo?.(pct*dur,true); setProgress(pct); setCurrentTime(pct*dur) }
    }
  },[duration])

  // Re-register MediaSession handlers on track/state change (Bluetooth headunit fix)
  useEffect(()=>{
    if(typeof window==='undefined'||!('mediaSession' in navigator)) return
    const doNext=()=>{ const n=getNext(currentRef.current); if(n) playInnerRef.current?.(n) }
    const doPrev=()=>{ const p=getPrev(currentRef.current); if(p) playInnerRef.current?.(p) }
    const doPlay=()=>{ if(audioModeRef.current==='native') nativeAudio.current?.play().catch(()=>{}); else ytPlayer.current?.playVideo?.(); silentAudio.current?.play().catch(()=>{}); setIsPlaying(true); isPlayingRef.current=true }
    const doPause=()=>{ if(audioModeRef.current==='native') nativeAudio.current?.pause(); else ytPlayer.current?.pauseVideo?.(); silentAudio.current?.pause(); setIsPlaying(false); isPlayingRef.current=false }
    navigator.mediaSession.setActionHandler('play',doPlay)
    navigator.mediaSession.setActionHandler('pause',doPause)
    navigator.mediaSession.setActionHandler('nexttrack',doNext)
    navigator.mediaSession.setActionHandler('previoustrack',doPrev)
    navigator.mediaSession.setActionHandler('seekbackward',doPrev)
    navigator.mediaSession.setActionHandler('seekforward',doNext)
    if(currentTrack) updateMediaSession(currentTrack,isPlaying)
  },[currentTrack,isPlaying]) // eslint-disable-line

  const addToQueue     =useCallback((tracks:Track[])=>setQueue(q=>[...q,...tracks.filter(t=>!q.find(x=>x.id===t.id))]),[])
  const removeFromQueue=useCallback((id:string)=>setQueue(q=>q.filter(t=>t.id!==id)),[])
  const setActiveList  =useCallback((t:Track[])=>{ setActiveListS(t); listRef.current=t },[])

  return(
    <Ctx.Provider value={{currentTrack,queue,isPlaying,progress,currentTime,duration,
      playTrack,togglePlay,next,prev,addToQueue,removeFromQueue,
      seek,shuffle,toggleShuffle:()=>setShuffle(s=>!s),
      repeat,cycleRepeat:()=>setRepeat(r=>r==='none'?'one':r==='one'?'all':'none'),
      activeList,setActiveList}}>
      {children}
      {loadingAudio&&(
        <div style={{position:'fixed',top:0,left:0,right:0,height:4,zIndex:999}}>
          <div style={{height:'100%',background:'var(--accent)',width:'60%',animation:'spin 1s linear infinite',borderRadius:2}}/>
        </div>
      )}
      <div style={{position:'fixed',bottom:-9999,left:-9999,width:1,height:1,overflow:'hidden',pointerEvents:'none'}} aria-hidden="true">
        <div id="yt-iframe"/>
      </div>
    </Ctx.Provider>
  )
}
function EqBars({active}:{active:boolean}){
  return(
    <div style={{display:'flex',alignItems:'flex-end',gap:3,height:24,flexShrink:0}}>
      {[1,2,3,4].map(i=>(
        <div key={i} style={{width:5,background:'var(--accent)',borderRadius:3,
          height:active?undefined:5,
          animation:active?`eq${i} ${0.6+i*0.15}s ease-in-out infinite`:'none'}}/>
      ))}
    </div>
  )
}

// ─── Progress Bar ─────────────────────────────────────────────────────────────
function ProgressBar(){
  const{progress,seek,currentTime,duration}=usePlayer()
  const barRef=useRef<HTMLDivElement>(null)
  const dragging=useRef(false)
  const calc=(e:MouseEvent|TouchEvent)=>{
    const r=barRef.current!.getBoundingClientRect()
    const x='touches' in e?e.touches[0].clientX:e.clientX
    return Math.max(0,Math.min(1,(x-r.left)/r.width))
  }
  const onDown=(e:React.MouseEvent|React.TouchEvent)=>{
    dragging.current=true
    const r=barRef.current!.getBoundingClientRect()
    const x='touches' in e.nativeEvent?(e.nativeEvent as TouchEvent).touches[0].clientX:(e.nativeEvent as MouseEvent).clientX
    seek(Math.max(0,Math.min(1,(x-r.left)/r.width)))
  }
  useEffect(()=>{
    const mv=(e:MouseEvent|TouchEvent)=>{if(dragging.current&&barRef.current)seek(calc(e))}
    const up=()=>{dragging.current=false}
    window.addEventListener('mousemove',mv);window.addEventListener('touchmove',mv,{passive:true})
    window.addEventListener('mouseup',up);window.addEventListener('touchend',up)
    return()=>{
      window.removeEventListener('mousemove',mv);window.removeEventListener('touchmove',mv)
      window.removeEventListener('mouseup',up);window.removeEventListener('touchend',up)
    }
  },[seek])
  return(
    <div style={{display:'flex',alignItems:'center',gap:12}}>
      <span style={{fontSize:15,color:'var(--text-dim)',minWidth:44,fontVariantNumeric:'tabular-nums'}}>{fmt(currentTime)}</span>
      <div ref={barRef} onMouseDown={onDown} onTouchStart={onDown}
        style={{flex:1,height:36,display:'flex',alignItems:'center',cursor:'pointer',touchAction:'none'}}>
        <div style={{width:'100%',height:8,background:'rgba(255,255,255,0.12)',borderRadius:6,position:'relative'}}>
          <div style={{width:`${progress*100}%`,height:'100%',background:'var(--accent)',borderRadius:6,position:'relative'}}>
            <div style={{position:'absolute',right:-12,top:'50%',transform:'translateY(-50%)',
              width:24,height:24,borderRadius:'50%',background:'var(--accent)',
              boxShadow:'0 0 10px rgba(232,255,71,0.9)'}}/>
          </div>
        </div>
      </div>
      <span style={{fontSize:15,color:'var(--text-dim)',minWidth:44,textAlign:'right',fontVariantNumeric:'tabular-nums'}}>{fmt(duration)}</span>
    </div>
  )
}

// ─── Player Bar ───────────────────────────────────────────────────────────────
function PlayerBar(){
  const{currentTrack,isPlaying,togglePlay,next,prev,shuffle,toggleShuffle,repeat,cycleRepeat,progress}=usePlayer()
  const[expanded,setExpanded]=useState(false)

  const mini=(
    <div style={{position:'fixed',bottom:0,left:0,right:0,zIndex:100,
      background:'rgba(8,8,14,0.98)',backdropFilter:'blur(24px)',
      borderTop:'2px solid var(--border)'}}>
      <div style={{height:4,background:'rgba(255,255,255,0.08)'}}>
        <div style={{height:'100%',background:'var(--accent)',width:`${Math.round(progress*100)}%`,transition:'width 0.5s linear'}}/>
      </div>
      <div style={{display:'flex',alignItems:'center',gap:12,padding:'12px 16px',minHeight:80}}>
        <div onClick={()=>setExpanded(true)} style={{flexShrink:0,cursor:'pointer',position:'relative'}}>
          {currentTrack?.thumbnail
            ?<img src={currentTrack.thumbnail} alt="" style={{width:56,height:56,borderRadius:12,objectFit:'cover',display:'block'}}/>
            :<div style={{width:56,height:56,borderRadius:12,background:'var(--bg3)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:26}}>🎵</div>
          }
          {isPlaying&&<div style={{position:'absolute',inset:0,borderRadius:12,background:'rgba(0,0,0,0.45)',display:'flex',alignItems:'center',justifyContent:'center'}}><EqBars active={true}/></div>}
        </div>
        <div onClick={()=>setExpanded(true)} style={{flex:1,overflow:'hidden',cursor:'pointer'}}>
          <div style={{fontSize:18,fontWeight:800,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis',
            color:currentTrack?'var(--text)':'var(--text-muted)'}}>{currentTrack?.title||'Tap a track to play'}</div>
          {currentTrack&&<div style={{fontSize:15,color:'var(--text-dim)',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis',marginTop:3}}>{currentTrack.artist}</div>}
        </div>
        <button onClick={prev}        style={{fontSize:32,color:'var(--text-dim)',padding:8,background:'none',border:'none',cursor:'pointer',flexShrink:0}}>⏮</button>
        <button onClick={togglePlay}
          style={{width:58,height:58,borderRadius:'50%',background:'var(--accent)',color:'#000',
            fontSize:26,display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0,border:'none',cursor:'pointer',
            boxShadow:isPlaying?'0 0 24px rgba(232,255,71,0.6)':'none'}}>
          {isPlaying?'⏸':'▶'}
        </button>
        <button onClick={next}        style={{fontSize:32,color:'var(--text-dim)',padding:8,background:'none',border:'none',cursor:'pointer',flexShrink:0}}>⏭</button>
      </div>
    </div>
  )

  const full=(
    <div style={{position:'fixed',inset:0,background:'var(--bg)',zIndex:200,
      display:'flex',flexDirection:'column',padding:'20px 24px 40px',overflowY:'auto'}}>
      <button onClick={()=>setExpanded(false)}
        style={{alignSelf:'flex-start',fontSize:36,color:'var(--text-dim)',padding:'4px 8px',marginBottom:12,background:'none',border:'none',cursor:'pointer'}}>⌄</button>
      <div style={{flex:1,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:28}}>
        {currentTrack?.thumbnail
          ?<img src={currentTrack.thumbnail} alt="" style={{width:'min(280px,85vw)',height:'min(280px,85vw)',borderRadius:20,objectFit:'cover',boxShadow:'0 28px 70px rgba(0,0,0,0.7)'}}/>
          :<div style={{width:240,height:240,borderRadius:20,background:'var(--bg3)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:72}}>🎵</div>
        }
        <div style={{textAlign:'center',width:'100%',padding:'0 8px'}}>
          <div style={{fontSize:24,fontWeight:900,marginBottom:10,lineHeight:1.2}}>{currentTrack?.title||'—'}</div>
          <div style={{fontSize:20,color:'var(--text-dim)'}}>{currentTrack?.artist||'—'}</div>
        </div>
        <div style={{width:'100%'}}><ProgressBar/></div>
        <div style={{display:'flex',alignItems:'center',gap:24}}>
          <button onClick={toggleShuffle} style={{fontSize:32,color:shuffle?'var(--accent)':'var(--text-dim)',padding:12,background:'none',border:'none',cursor:'pointer'}}>⇄</button>
          <button onClick={prev}          style={{fontSize:48,color:'var(--text)',padding:12,background:'none',border:'none',cursor:'pointer'}}>⏮</button>
          <button onClick={togglePlay}
            style={{width:80,height:80,borderRadius:'50%',background:'var(--accent)',color:'#000',fontSize:36,
              display:'flex',alignItems:'center',justifyContent:'center',border:'none',cursor:'pointer',
              boxShadow:isPlaying?'0 0 40px rgba(232,255,71,0.7)':'none'}}>
            {isPlaying?'⏸':'▶'}
          </button>
          <button onClick={next}          style={{fontSize:48,color:'var(--text)',padding:12,background:'none',border:'none',cursor:'pointer'}}>⏭</button>
          <button onClick={cycleRepeat}   style={{fontSize:32,color:repeat!=='none'?'var(--accent)':'var(--text-dim)',padding:12,background:'none',border:'none',cursor:'pointer'}}>
            {repeat==='one'?'🔂':'🔁'}
          </button>
        </div>
      </div>
    </div>
  )

  return <>{expanded?full:mini}</>
}


// ─── Track Card ───────────────────────────────────────────────────────────────
function TrackCard({track,list,index,active}:{track:Track;list:Track[];index:number;active:boolean}){
  const{playTrack,addToQueue,queue,isPlaying,currentTrack}=usePlayer()
  const[expanded,setExpanded]=useState(false)
  const[mixTracks,setMixTracks]=useState<Track[]>([])
  const[loadingMix,setLoadingMix]=useState(false)
  const inQueue=queue.some(q=>q.id===track.id)
  const isMix=!!(track.isMix)

  const loadMix=async(e:React.MouseEvent)=>{
    e.stopPropagation()
    if(expanded){setExpanded(false);return}
    setExpanded(true)
    if(mixTracks.length>0)return
    setLoadingMix(true)
    try{
      const listId=track.playlistId||('RD'+track.id)
      const params=new URLSearchParams({listId, videoId:track.id})
      const r=await fetch('/api/yt-playlist?'+params).then(r=>r.json())
      const items=(r.items||[]).map((t:any):Track=>({...t,source:'youtube' as const}))
      setMixTracks(items.length>0?items:[track])
    }catch{setMixTracks([track])}
    finally{setLoadingMix(false)}
  }

  return(
    <div style={{borderRadius:16,overflow:'hidden',
      background:active?'rgba(232,255,71,0.09)':'var(--card)',
      border:'2px solid '+(active?'rgba(232,255,71,0.4)':'var(--border)'),
      width:'100%',boxSizing:'border-box',
      animation:'slideUp 0.3s ease both',animationDelay:Math.min(index*20,400)+'ms'}}>
      <div onClick={()=>{ if(!isMix) playTrack(track,list) }}
        style={{display:'flex',alignItems:'stretch',cursor:'pointer',minHeight:100}}>
        <div style={{position:'relative',flexShrink:0,width:100,height:100}}>
          {track.thumbnail
            ?<img src={track.thumbnail} alt="" style={{width:100,height:100,objectFit:'cover',display:'block'}}/>
            :<div style={{width:100,height:100,background:'var(--bg3)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:32}}>🎵</div>
          }
          {active&&isPlaying&&(
            <div style={{position:'absolute',inset:0,background:'rgba(0,0,0,0.5)',display:'flex',alignItems:'center',justifyContent:'center'}}>
              <EqBars active={true}/>
            </div>
          )}
        </div>
        <div style={{flex:1,minWidth:0,padding:'12px 10px',display:'flex',flexDirection:'column',justifyContent:'center',gap:5}}>
          <div style={{fontSize:19,fontWeight:800,lineHeight:1.25,color:active?'var(--accent)':'var(--text)',
            overflow:'hidden',display:'-webkit-box',WebkitLineClamp:2,WebkitBoxOrient:'vertical' as any}}>
            {track.title}
          </div>
          <div style={{fontSize:15,color:'var(--text-dim)',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{track.artist}</div>
          <div style={{display:'flex',alignItems:'center',gap:8}}>
            {track.duration&&<span style={{fontSize:13,color:'var(--text-muted)'}}>{track.duration}</span>}
            {isMix&&<span style={{fontSize:12,background:'rgba(232,255,71,0.15)',color:'var(--accent)',padding:'2px 8px',borderRadius:6,fontWeight:700}}>PLAYLIST</span>}
          </div>
        </div>
        <div style={{display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',padding:'0 10px',gap:8,flexShrink:0}}>
          {isMix?(
            <button onClick={loadMix}
              style={{width:48,height:48,borderRadius:12,fontSize:22,border:'none',cursor:'pointer',
                background:expanded?'var(--accent)':'var(--bg3)',color:expanded?'#000':'var(--text-dim)',
                display:'flex',alignItems:'center',justifyContent:'center'}}>
              {expanded?'▲':'▼'}
            </button>
          ):(
            <button onClick={e=>{e.stopPropagation();if(!inQueue)addToQueue([track])}}
              style={{width:48,height:48,borderRadius:12,fontSize:26,border:'none',cursor:'pointer',
                background:inQueue?'rgba(232,255,71,0.12)':'var(--bg3)',
                color:inQueue?'var(--accent)':'var(--text-dim)',
                display:'flex',alignItems:'center',justifyContent:'center'}}>
              {inQueue?'✓':'+'}
            </button>
          )}
        </div>
      </div>

      {isMix&&expanded&&(
        <div style={{borderTop:'2px solid var(--border)',background:'var(--bg2)'}}>
          {loadingMix&&(
            <div style={{display:'flex',alignItems:'center',justifyContent:'center',padding:'20px',gap:12}}>
              <div style={{width:24,height:24,border:'3px solid var(--border)',borderTop:'3px solid var(--accent)',borderRadius:'50%',animation:'spin 0.8s linear infinite'}}/>
              <span style={{color:'var(--text-dim)',fontSize:16}}>Loading tracks...</span>
            </div>
          )}
          {!loadingMix&&mixTracks.map((mt,mi)=>(
            <div key={mt.id} onClick={()=>playTrack(mt,mixTracks)}
              style={{display:'flex',alignItems:'center',gap:12,padding:'12px 14px',cursor:'pointer',
                borderBottom:'1px solid var(--border)',
                background:currentTrack?.id===mt.id?'rgba(232,255,71,0.08)':'transparent'}}>
              <span style={{fontSize:15,color:'var(--text-muted)',minWidth:28,textAlign:'right',fontWeight:700,flexShrink:0}}>{mi+1}</span>
              {mt.thumbnail&&<img src={mt.thumbnail} alt="" style={{width:52,height:52,borderRadius:8,objectFit:'cover',flexShrink:0}}/>}
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontSize:17,fontWeight:700,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis',
                  color:currentTrack?.id===mt.id?'var(--accent)':'var(--text)'}}>{mt.title}</div>
                <div style={{fontSize:14,color:'var(--text-dim)',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{mt.artist}</div>
              </div>
              {mt.duration&&<span style={{fontSize:13,color:'var(--text-muted)',flexShrink:0,marginLeft:8}}>{mt.duration}</span>}
            </div>
          ))}
          {!loadingMix&&mixTracks.length>0&&(
            <div style={{padding:'10px 14px',display:'flex',gap:10}}>
              <button onClick={e=>{e.stopPropagation();addToQueue(mixTracks);playTrack(mixTracks[0],mixTracks)}}
                style={{flex:1,padding:'12px',borderRadius:12,background:'var(--accent)',color:'#000',fontSize:16,fontWeight:800,border:'none',cursor:'pointer'}}>
                ▶ Play All ({mixTracks.length})
              </button>
              <button onClick={e=>{e.stopPropagation();addToQueue(mixTracks)}}
                style={{padding:'12px 16px',borderRadius:12,background:'var(--bg3)',color:'var(--text)',fontSize:16,fontWeight:700,border:'2px solid var(--border)',cursor:'pointer'}}>
                + Queue All
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Main App ─────────────────────────────────────────────────────────────────
function MainApp(){
  const{currentTrack,playTrack,addToQueue,setActiveList,queue,togglePlay,next,prev,isPlaying}=usePlayer()
  const[view,setView]=useState<'home'|'genre'|'search'|'radio'>('home')
  const[selectedGenre,setSelectedGenre] =useState<typeof GENRES[0]|null>(null)
  const[searchQuery,setSearchQuery]     =useState('')
  const[searchResults,setSearchResults] =useState<Track[]>([])
  const[genreTracks,setGenreTracks]     =useState<Track[]>([])
  const[loading,setLoading]             =useState(false)
  const[loadingMore,setLoadingMore]     =useState(false)
  const[showQueue,setShowQueue]         =useState(false)
  const[playlistSize,setPlaylistSize]   =useState(20)
  const allSuggestedRef=useRef<string[]>([])
  const radioAudioRef=useRef<HTMLAudioElement|null>(null)
  const radioStationsRef=useRef<Station[]>([])
  const playingStationRef=useRef<string|null>(null)
  const viewRef=useRef<string>('home')
  const scrollRef=useRef<HTMLDivElement>(null)



  const ytSearch=async(q:string):Promise<Track[]>=>{
    try{
      const r=await fetch('/api/search-youtube?q='+encodeURIComponent(q)).then(r=>r.json())
      return(r.results||[]).map((v:any):Track=>({
        id:v.id,youtubeId:v.id,title:v.title,artist:v.channel,
        channel:v.channel,thumbnail:v.thumbnail,duration:v.duration,
        source:'youtube',isMix:!!(v.isMix),playlistId:v.playlistId||undefined,
        durationSecs:v.durationSecs
      }))
    }catch{return[]}
  }

  const ytSearchArtist=async(artist:string):Promise<Track[]>=>{
    try{
      const enc=(s:string)=>encodeURIComponent(s)
      const [r1,r2,r3]=await Promise.all([
        fetch('/api/search-youtube?q='+enc(artist)).then(r=>r.json()),
        fetch('/api/search-youtube?q='+enc(artist+' official video')).then(r=>r.json()),
        fetch('/api/search-youtube?q='+enc(artist+' official audio')).then(r=>r.json()),
      ])
      const seen=new Set<string>()
      return [...(r1.results||[]),...(r2.results||[]),...(r3.results||[])]
        .filter((v:any)=>{ if(seen.has(v.id)) return false; seen.add(v.id); return true })
        .sort((a:any,b:any)=>(b.viewCount||b.score||0)-(a.viewCount||a.score||0))
        .slice(0,20)
        .map((v:any):Track=>({
          id:v.id,youtubeId:v.id,title:v.title,artist:v.channel,
          channel:v.channel,thumbnail:v.thumbnail,duration:v.duration,
          source:'youtube',isMix:false,playlistId:undefined,
          durationSecs:v.durationSecs
        }))
    }catch{return[]}
  }

  const doVoiceSearch=async(q:string)=>{
    if(!q.trim()) return
    setLoading(true)
    setView('search')
    setSearchQuery(q)
    setSearchResults([])
    try{
      // Search for the specific song first
      const songResults=await ytSearch(q)
      const best=songResults[0]
      if(!best){ setLoading(false); return }

      // Get more from same artist sorted by popularity
      const artist=best.artist||best.channel||''
      const more=artist
        ? (await ytSearchArtist(artist)).filter(t=>t.id!==best.id).slice(0,19)
        : songResults.slice(1,19)

      const fullList:Track[]=[best,...more]
      setSearchResults(fullList)
      setActiveList(fullList)
      playTrack(best,fullList)
      addToQueue(more)
    }finally{
      setLoading(false)
    }
  }

  const loadGenrePlaylist=async(genre:typeof GENRES[0],more=false)=>{
    if(more)setLoadingMore(true);else{setLoading(true);setGenreTracks([])}
    try{
      let tracks:Track[]=[]
      const seen=new Set<string>(more?genreTracks.map(t=>t.id):[])
      let usedGroq=false
      try{
        const existing=allSuggestedRef.current
        const aiRes=await fetch('/api/generate-playlist',{
          method:'POST',headers:{'Content-Type':'application/json'},
          body:JSON.stringify({genre:genre.label,count:playlistSize,existingSongs:existing})
        })
        if(aiRes.ok){
          const d=await aiRes.json()
          if(d.songs?.length){
            usedGroq=true
            allSuggestedRef.current=[...existing,...d.songs.map((s:any)=>`${s.title} by ${s.artist}`)]
            const batchSize=6
            for(let i=0;i<d.songs.length;i+=batchSize){
              const batch=d.songs.slice(i,i+batchSize)
              const results=await Promise.all(batch.map(async(s:any)=>{
                const res=await ytSearch(`${s.artist} ${s.title} official audio`)
                return res.filter(t=>!seen.has(t.id)).slice(0,2)
              }))
              for(const g of results){for(const t of g){if(!seen.has(t.id)){seen.add(t.id);tracks.push(t)}}}
            }
          }
        }
      }catch{}

      if(!usedGroq||tracks.length<5){
        const shuffledQ=[...genre.queries].sort(()=>Math.random()-0.5)
        const results=await Promise.all(shuffledQ.map(q=>ytSearch(q)))
        for(const res of results){for(const t of res){if(!seen.has(t.id)){seen.add(t.id);tracks.push(t)}}}
        tracks=tracks.sort(()=>Math.random()-0.5)
      }

      const next=more?[...genreTracks,...tracks]:tracks
      setGenreTracks(next);setActiveList(next)
      if(!more&&tracks.length>0){addToQueue(tracks);playTrack(tracks[0],next)}
      else if(more)addToQueue(tracks)
    }finally{setLoading(false);setLoadingMore(false)}
  }

  // ── Radio stations — shuffled fresh each time ──────────────────────────────
  // Genre icons for radio stations
  const RADIO_GENRE_ICONS:Record<string,string> = {
    'rock':'🎸','hard rock':'🤘','classic rock':'🏟️','soft rock':'🌈',
    'alternative':'🌀','pop':'🌟','metal':'💀','punk':'✊','grunge':'⚡',
    'indie':'🎵','country':'🤠','80s':'8️⃣','90s':'9️⃣','hair metal':'🦁',
    'default':'📻'
  }
  const stationIcon=(tags:string)=>{
    const t=tags.toLowerCase()
    for(const [key,icon] of Object.entries(RADIO_GENRE_ICONS)){
      if(t.includes(key)) return icon
    }
    return '📻'
  }

  type Station={name:string;genre:string;url:string;logo:string}
  const[radioStations,setRadioStations]=useState<Station[]>([])
  const[playingStation,setPlayingStation]=useState<string|null>(null)
  const[radioLoading,setRadioLoading]=useState(false)
  const[favorites,setFavorites]=useState<Station[]>(()=>{
    try{ return JSON.parse(localStorage.getItem('radioFavorites')||'[]') }catch{ return[] }
  })

  // Keep refs in sync so car controls always have fresh values
  useEffect(()=>{ radioStationsRef.current=radioStations },[radioStations])
  useEffect(()=>{ playingStationRef.current=playingStation },[playingStation])
  useEffect(()=>{ viewRef.current=view },[view])

  const toggleFavorite=(station:Station,e:React.MouseEvent)=>{
    e.stopPropagation()
    setFavorites(prev=>{
      const exists=prev.some(f=>f.name===station.name)
      const next=exists?prev.filter(f=>f.name!==station.name):[...prev,station]
      try{ localStorage.setItem('radioFavorites',JSON.stringify(next)) }catch{}
      return next
    })
  }
  const isFavorite=(name:string)=>favorites.some(f=>f.name===name)

  const fetchRadioStations=async()=>{
    setRadioLoading(true)
    setRadioStations([])
    try{
      // Radio Browser API supports CORS — call directly from browser
      // Mix of tags to get variety: rock, hard rock, classic rock, soft rock, pop
      const tags=['rock','hard rock','classic rock','soft rock','pop','alternative rock','hair metal']
      const chosen=tags.sort(()=>Math.random()-0.5).slice(0,4)
      const results=await Promise.all(chosen.map(tag=>
        fetch(`https://de1.api.radio-browser.info/json/stations/bytag/${encodeURIComponent(tag)}?limit=20&hidebroken=true&order=clickcount&reverse=true&codec=MP3`)
          .then(r=>r.json())
          .catch(()=>[] as any[])
      ))
      const seen=new Set<string>()
      const stations:Station[]=results.flat()
        .filter((s:any)=>{
          if(!s.url_resolved||!s.name) return false
          if(seen.has(s.stationuuid)) return false
          seen.add(s.stationuuid)
          return true
        })
        .sort(()=>Math.random()-0.5)
        .slice(0,50)
        .map((s:any):Station=>({
          name: s.name.trim(),
          genre: s.tags?.split(',')[0]||s.country||'Radio',
          url: s.url_resolved,
          logo: stationIcon(s.tags||''),
        }))
      setRadioStations(stations)
    }catch(e){
      console.error('Radio fetch failed',e)
    }finally{
      setRadioLoading(false)
    }
  }

  const openRadio=()=>{
    setView('radio')
    fetchRadioStations()
  }

  const playStation=(station:Station)=>{
    setPlayingStation(station.name)
    if(!radioAudioRef.current) radioAudioRef.current=new Audio()
    const audio=radioAudioRef.current
    audio.pause()
    audio.src=station.url
    audio.load()
    audio.play().catch(()=>{
      setTimeout(()=>audio.play().catch(()=>{
        // If it still fails mark it as errored
        setPlayingStation(p=>p===station.name?null:p)
      }),800)
    })
  }

  const stopRadio=()=>{
    radioAudioRef.current?.pause()
    setPlayingStation(null)
  }

  const selectGenre=(genre:typeof GENRES[0])=>{
    if(genre.id==='radio'){ openRadio(); return }
    setSelectedGenre(genre);setView('genre')
    allSuggestedRef.current=[]
    loadGenrePlaylist(genre,false)
  }

  const doSearch=async(q:string,asPlaylist=false)=>{
    if(!q.trim())return
    setLoading(true);setView('search');setSearchResults([])
    try{
      const seen=new Set<string>()
      let tracks:Track[]=[]
      if(asPlaylist){
        let songs:{title:string;artist:string}[]=[]
        try{
          const aiRes=await fetch('/api/generate-playlist',{
            method:'POST',headers:{'Content-Type':'application/json'},
            body:JSON.stringify({genre:q,count:30,existingSongs:[]})
          })
          if(aiRes.ok){const d=await aiRes.json();songs=d.songs||[]}
        }catch{}
        const direct=await ytSearch(q)
        for(const t of direct){if(!seen.has(t.id)){seen.add(t.id);tracks.push(t)}}
        if(songs.length){
          const batchSize=6
          for(let i=0;i<Math.min(songs.length,24);i+=batchSize){
            const batch=songs.slice(i,i+batchSize)
            const results=await Promise.all(batch.map(s=>ytSearch(`${s.artist} ${s.title} official`)))
            for(const res of results){for(const t of res.slice(0,2)){if(!seen.has(t.id)){seen.add(t.id);tracks.push(t)}}}
          }
        }
      }else{
        const queries=[q,`${q} official audio`,`${q} music video`,`best of ${q}`]
        const results=await Promise.all(queries.map(qu=>ytSearch(qu)))
        for(const res of results){for(const t of res){if(!seen.has(t.id)){seen.add(t.id);tracks.push(t)}}}
        tracks=tracks.sort(()=>Math.random()-0.5)
      }
      setSearchResults(tracks);setActiveList(tracks)
    }finally{setLoading(false)}
  }
  useEffect(()=>{
    const handleMessage=(event:MessageEvent)=>{
      const data=event.data
      if(!data||typeof data!=='object'||(!data.type&&!data.query)) return
      if(data.type==='voiceSearch'||data.type==='search'){
        const query=String(data.query||'').trim()
        if(!query) return
        if(data.type==='voiceSearch') doVoiceSearch(query)
        else { setSearchQuery(query); doSearch(query) }
      }
    }
    window.addEventListener('message',handleMessage)
    ;(window as any).voiceSearch=(q:string)=>doVoiceSearch(q)

    // ── Car stereo controls — use refs so values are always fresh ─────────────
    ;(window as any).carControl=(action:string)=>{
      const inRadio=viewRef.current==='radio'
      const stations=radioStationsRef.current
      const playing=playingStationRef.current
      if(inRadio){
        const idx=stations.findIndex(s=>s.name===playing)
        if(action==='next'){
          const n=stations[(idx+1)%stations.length]
          if(n) playStation(n)
        } else if(action==='prev'){
          const p=stations[(idx-1+stations.length)%stations.length]
          if(p) playStation(p)
        } else if(action==='togglePlay'){
          if(playing) stopRadio()
          else if(stations.length) playStation(stations[0])
        } else if(action==='stop'){
          stopRadio()
        }
      } else {
        if(action==='togglePlay') togglePlay()
        else if(action==='next')  next()
        else if(action==='prev')  prev()
        else if(action==='stop'&&isPlaying) togglePlay()
      }
    }

    // ── Bluetooth auto-start ──────────────────────────────────────────────────
    ;(window as any).bluetoothAutoStart=()=>{
      if(viewRef.current==='radio'){
        if(!playingStationRef.current&&radioStationsRef.current.length)
          playStation(radioStationsRef.current[0])
      } else if(currentTrack){
        if(!isPlaying) togglePlay()
      } else {
        const g=GENRES.filter(x=>x.id!=='radio')
        selectGenre(g[Math.floor(Math.random()*g.length)])
      }
    }
    ;(window as any).bluetoothDisconnected=()=>{
      if(isPlaying) togglePlay()
      stopRadio()
    }
    return()=>window.removeEventListener('message',handleMessage)
  },[])
  return(
    <div style={{display:'flex',height:'100dvh',flexDirection:'column',overflow:'hidden',background:'var(--bg)'}}>

      {/* TOP BAR */}
      <div style={{flexShrink:0,background:'var(--bg2)',borderBottom:'2px solid var(--border)',padding:'14px 14px 12px',boxSizing:'border-box'}}>
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:12}}>
          <div>
            <span className="font-display" style={{fontSize:32,color:'var(--accent)',letterSpacing:'0.06em'}}>SONIC</span>
            <span className="font-display" style={{fontSize:32,color:'var(--text-dim)',letterSpacing:'0.06em',marginLeft:8}}>WAVE</span>
          </div>
          <button onClick={()=>setShowQueue(s=>!s)}
            style={{padding:'10px 18px',borderRadius:12,
              background:showQueue?'rgba(232,255,71,0.12)':'var(--card)',
              border:`2px solid ${showQueue?'rgba(232,255,71,0.4)':'var(--border)'}`,
              color:showQueue?'var(--accent)':'var(--text)',fontSize:18,fontWeight:700,cursor:'pointer'}}>
            🎶 {queue.length}
          </button>
        </div>

        {/* Search */}
        <div style={{display:'flex',gap:10,marginBottom:14,boxSizing:'border-box'}}>
          <div style={{position:'relative',flex:1,minWidth:0}}>
            <input type="text" placeholder="Artists, songs..." value={searchQuery}
              onChange={e=>setSearchQuery(e.target.value)}
              onKeyDown={e=>e.key==='Enter'&&doSearch(searchQuery)}
              style={{width:'100%',padding:'18px 56px 18px 18px',
                background:'var(--card)',border:'2px solid var(--border)',borderRadius:16,
                color:'var(--text)',fontSize:20,outline:'none',
                WebkitAppearance:'none',boxSizing:'border-box',fontWeight:600}}/>
            <button onClick={()=>doSearch(searchQuery)}
              style={{position:'absolute',right:16,top:'50%',transform:'translateY(-50%)',fontSize:28,color:'var(--text-dim)',background:'none',border:'none',cursor:'pointer'}}>⌕</button>
          </div>
          <button onClick={()=>doSearch(searchQuery,true)}
            style={{padding:'18px 18px',borderRadius:16,background:'var(--accent)',color:'#000',
              fontWeight:900,fontSize:16,flexShrink:0,whiteSpace:'nowrap',border:'none',cursor:'pointer'}}>
            🎵 Playlist
          </button>
        </div>

        {/* Genre grid (home) or scroll strip (search/genre) */}
        {view==='home'?(
          <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:10}}>
            {GENRES.map(g=>(
              <button key={g.id} onClick={()=>selectGenre(g)}
                style={{padding:'16px 8px',borderRadius:16,textAlign:'center',fontSize:18,fontWeight:800,
                  background:`${g.color}22`,color:g.color,
                  border:`2px solid ${g.color}55`,transition:'all 0.15s',cursor:'pointer',
                  display:'flex',flexDirection:'column',alignItems:'center',gap:6}}>
                <span style={{fontSize:28}}>{g.icon}</span>
                <span>{g.label}</span>
              </button>
            ))}
          </div>
        ):(
          <div style={{overflowX:'auto',WebkitOverflowScrolling:'touch',scrollbarWidth:'none'}}>
            <div style={{display:'flex',gap:10,paddingBottom:4,width:'max-content'}}>
              {GENRES.map(g=>(
                <button key={g.id} onClick={()=>selectGenre(g)}
                  style={{padding:'12px 18px',borderRadius:24,whiteSpace:'nowrap',flexShrink:0,
                    fontSize:17,fontWeight:700,cursor:'pointer',
                    background:selectedGenre?.id===g.id?g.color:`${g.color}22`,
                    color:selectedGenre?.id===g.id?'#000':g.color,
                    border:`2px solid ${selectedGenre?.id===g.id?g.color:g.color+'66'}`}}>
                  {g.icon} {g.label}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* CONTENT */}
      <div ref={scrollRef} tabIndex={0} style={{flex:1,overflowY:'auto',WebkitOverflowScrolling:'touch',paddingBottom:100,outline:'none'}}>

        {loading&&(
          <div style={{display:'flex',flexDirection:'column',alignItems:'center',padding:'80px 0',gap:18}}>
            <div style={{width:52,height:52,border:'5px solid var(--border)',borderTop:'5px solid var(--accent)',borderRadius:'50%',animation:'spin 0.8s linear infinite'}}/>
            <div style={{color:'var(--text-dim)',fontSize:20,fontWeight:600}}>
              {view==='genre'?`Building ${selectedGenre?.label} playlist...`:'Searching...'}
            </div>
          </div>
        )}

        {view==='home'&&!loading&&(
          <div style={{textAlign:'center',padding:'50px 24px'}}>
            <div style={{fontSize:22,color:'var(--text-dim)',lineHeight:2}}>👆 Pick a genre above<br/>or search for any artist</div>
          </div>
        )}

        {view==='radio'&&(
          <div style={{padding:'16px 14px'}}>
            <div style={{display:'flex',alignItems:'center',gap:12,marginBottom:16,flexWrap:'wrap'}}>
              <h2 style={{fontSize:32,color:'#00bcd4'}}>📻 RADIO STATIONS</h2>
              <button onClick={fetchRadioStations} disabled={radioLoading}
                style={{marginLeft:'auto',padding:'10px 18px',borderRadius:12,
                  background:radioLoading?'var(--bg3)':'#00bcd422',
                  color:radioLoading?'var(--text-muted)':'#00bcd4',
                  border:'2px solid #00bcd4',fontSize:15,fontWeight:700,cursor:'pointer'}}>
                {radioLoading?'⏳ Loading...':'↺ Reshuffle'}
              </button>
              {playingStation&&(
                <button onClick={stopRadio}
                  style={{padding:'10px 18px',borderRadius:12,background:'#ff174422',
                    color:'#ff1744',border:'2px solid #ff1744',fontSize:15,fontWeight:700,cursor:'pointer'}}>
                  ⏹ Stop
                </button>
              )}
            </div>
            {radioLoading&&(
              <div style={{display:'flex',flexDirection:'column',alignItems:'center',padding:'60px 0',gap:16}}>
                <div style={{width:48,height:48,border:'4px solid var(--border)',borderTop:'4px solid #00bcd4',borderRadius:'50%',animation:'spin 0.8s linear infinite'}}/>
                <div style={{color:'var(--text-dim)',fontSize:18}}>Finding live stations...</div>
              </div>
            )}
            {!radioLoading&&radioStations.length===0&&(
              <div style={{textAlign:'center',padding:'60px 0',color:'var(--text-dim)',fontSize:18}}>
                No stations loaded. <br/>
                <button onClick={fetchRadioStations} style={{marginTop:16,padding:'12px 24px',borderRadius:12,background:'#00bcd422',color:'#00bcd4',border:'2px solid #00bcd4',fontSize:16,fontWeight:700,cursor:'pointer'}}>Try Again</button>
              </div>
            )}
            {/* Favorites section */}
            {favorites.length>0&&(
              <div style={{marginBottom:18}}>
                <div style={{fontSize:14,fontWeight:700,color:'#ffb300',letterSpacing:2,marginBottom:10}}>★ FAVORITES</div>
                <div style={{display:'flex',flexDirection:'column',gap:8}}>
                  {favorites.map((s,i)=>(
                    <div key={i} style={{display:'flex',gap:8,alignItems:'stretch'}}>
                      <button onClick={()=>playingStation===s.name?stopRadio():playStation(s)}
                        style={{flex:1,display:'flex',alignItems:'center',gap:14,padding:'12px 16px',
                          borderRadius:14,textAlign:'left',cursor:'pointer',
                          background:playingStation===s.name?'#00bcd422':'#ffb30011',
                          border:playingStation===s.name?'2px solid #00bcd4':'2px solid #ffb30044',
                          transition:'all 0.15s'}}>
                        <span style={{fontSize:26,flexShrink:0}}>{s.logo}</span>
                        <div style={{flex:1,minWidth:0}}>
                          <div style={{fontWeight:700,fontSize:15,color:playingStation===s.name?'#00bcd4':'#ffb300',
                            whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>
                            {playingStation===s.name?'▶ ':''}{s.name}
                          </div>
                          <div style={{fontSize:12,color:'var(--text-muted)',marginTop:2,textTransform:'capitalize'}}>{s.genre}</div>
                        </div>
                        <span style={{fontSize:18,flexShrink:0,color:playingStation===s.name?'#00bcd4':'#ffb300'}}>
                          {playingStation===s.name?'🔊':'▶'}
                        </span>
                      </button>
                      <button onClick={(e)=>toggleFavorite(s,e)}
                        style={{width:48,borderRadius:14,border:'2px solid #ffb30044',
                          background:'#ffb30022',fontSize:22,cursor:'pointer',
                          flexShrink:0,color:'#ffb300'}}>★</button>
                    </div>
                  ))}
                </div>
                <div style={{height:1,background:'var(--border)',margin:'16px 0'}}/>
              </div>
            )}
            <div style={{display:'flex',flexDirection:'column',gap:10}}>
              {radioStations.map((s,i)=>(
                <div key={i} style={{display:'flex',gap:8,alignItems:'stretch'}}>
                  <button onClick={()=>playingStation===s.name?stopRadio():playStation(s)}
                    style={{flex:1,display:'flex',alignItems:'center',gap:14,padding:'14px 16px',
                      borderRadius:14,textAlign:'left',cursor:'pointer',
                      background:playingStation===s.name?'#00bcd422':'var(--card)',
                      border:playingStation===s.name?'2px solid #00bcd4':'2px solid var(--border)',
                      transition:'all 0.15s'}}>
                    <span style={{fontSize:28,flexShrink:0}}>{s.logo}</span>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontWeight:700,fontSize:16,color:playingStation===s.name?'#00bcd4':'var(--text)',
                        whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>
                        {playingStation===s.name?'▶ ':''}{s.name}
                      </div>
                      <div style={{fontSize:13,color:'var(--text-muted)',marginTop:2,textTransform:'capitalize'}}>{s.genre}</div>
                    </div>
                    <span style={{fontSize:20,flexShrink:0,color:playingStation===s.name?'#00bcd4':'var(--text-muted)'}}>
                      {playingStation===s.name?'🔊':'▶'}
                    </span>
                  </button>
                  <button onClick={(e)=>toggleFavorite(s,e)}
                    title={isFavorite(s.name)?'Remove from favorites':'Add to favorites'}
                    style={{width:48,borderRadius:14,border:'2px solid var(--border)',
                      background:isFavorite(s.name)?'#ffb30022':'var(--card)',
                      fontSize:22,cursor:'pointer',flexShrink:0,
                      color:isFavorite(s.name)?'#ffb300':'var(--text-muted)',
                      transition:'all 0.15s'}}>
                    {isFavorite(s.name)?'★':'☆'}
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {view==='genre'&&!loading&&selectedGenre&&(
          <div style={{padding:'16px 14px'}}>
            <div style={{display:'flex',alignItems:'center',gap:12,marginBottom:16,flexWrap:'wrap'}}>
              <h2 className="font-display" style={{fontSize:40,color:selectedGenre.color}}>
                {selectedGenre.icon} {selectedGenre.label.toUpperCase()}
              </h2>
              <span style={{color:'var(--text-muted)',fontSize:16,marginLeft:'auto'}}>{genreTracks.length} tracks</span>
            </div>
            <div style={{display:'flex',gap:10,marginBottom:18,flexWrap:'wrap',alignItems:'center'}}>
              <select value={playlistSize} onChange={e=>setPlaylistSize(Number(e.target.value))}
                style={{padding:'12px 14px',borderRadius:12,background:'var(--card)',border:'2px solid var(--border)',color:'var(--text)',fontSize:17,fontWeight:600}}>
                {[10,20,30,50].map(n=><option key={n} value={n}>{n} songs</option>)}
              </select>
              <button onClick={()=>{allSuggestedRef.current=[];loadGenrePlaylist(selectedGenre,false)}}
                style={{padding:'12px 20px',borderRadius:12,background:selectedGenre.color,color:'#000',fontSize:17,fontWeight:800,border:'none',cursor:'pointer'}}>
                ↺ Shuffle New
              </button>
              <button onClick={()=>loadGenrePlaylist(selectedGenre,true)} disabled={loadingMore}
                style={{padding:'12px 20px',borderRadius:12,background:'var(--bg3)',
                  color:loadingMore?'var(--text-muted)':'var(--text)',
                  border:'2px solid var(--border)',fontSize:17,fontWeight:700,cursor:'pointer'}}>
                {loadingMore?'⏳ Loading...':'+ Load More'}
              </button>
            </div>
            <div style={{display:'flex',flexDirection:'column',gap:12}}>
              {genreTracks.map((t,i)=><TrackCard key={t.id} track={t} list={genreTracks} index={i} active={currentTrack?.id===t.id}/>)}
            </div>
          </div>
        )}

        {view==='search'&&!loading&&(
          <div style={{padding:'16px 14px'}}>
            {searchResults.length===0&&(
              <div style={{color:'var(--text-muted)',textAlign:'center',marginTop:60,fontSize:20,lineHeight:2}}>
                Search above to find music<br/>
                <span style={{color:'var(--text-dim)',fontSize:17}}>Use <strong style={{color:'var(--accent)'}}>Playlist</strong> for a full artist playlist</span>
              </div>
            )}
            <div style={{display:'flex',flexDirection:'column',gap:12}}>
              {searchResults.map((t,i)=><TrackCard key={t.id} track={t} list={searchResults} index={i} active={currentTrack?.id===t.id}/>)}
            </div>
          </div>
        )}
      </div>

      {/* QUEUE */}
      {showQueue&&(
        <div style={{position:'fixed',right:0,top:0,bottom:0,width:'min(340px,95vw)',
          background:'rgba(10,10,18,0.99)',backdropFilter:'blur(24px)',
          borderLeft:'2px solid var(--border)',zIndex:150,display:'flex',flexDirection:'column',paddingBottom:90}}>
          <div style={{padding:'18px 16px 12px',display:'flex',alignItems:'center',justifyContent:'space-between',borderBottom:'2px solid var(--border)'}}>
            <span className="font-display" style={{fontSize:26}}>QUEUE ({queue.length})</span>
            <button onClick={()=>setShowQueue(false)} style={{fontSize:28,color:'var(--text-dim)',padding:8,background:'none',border:'none',cursor:'pointer'}}>✕</button>
          </div>
          <div style={{flex:1,overflowY:'auto',padding:'12px',display:'flex',flexDirection:'column',gap:10,outline:'none'}} tabIndex={-1}>
            {queue.length===0&&<div style={{color:'var(--text-muted)',textAlign:'center',marginTop:50,fontSize:18}}>Queue is empty</div>}
            {queue.map((t,i)=>{
              const p=usePlayer()
              return(
                <div key={t.id} onClick={()=>p.playTrack(t)}
                  style={{display:'flex',alignItems:'center',gap:12,padding:'12px',borderRadius:12,cursor:'pointer',
                    background:t.id===currentTrack?.id?'rgba(232,255,71,0.08)':'var(--card)',
                    border:`2px solid ${t.id===currentTrack?.id?'rgba(232,255,71,0.3)':'var(--border)'}`}}>
                  <span style={{color:'var(--text-muted)',fontSize:15,minWidth:24,textAlign:'center',fontWeight:700}}>{i+1}</span>
                  {t.thumbnail&&<img src={t.thumbnail} alt="" style={{width:48,height:48,borderRadius:8,objectFit:'cover'}}/>}
                  <div style={{flex:1,overflow:'hidden'}}>
                    <div style={{fontSize:16,fontWeight:700,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis',
                      color:t.id===currentTrack?.id?'var(--accent)':'var(--text)'}}>{t.title}</div>
                    <div style={{fontSize:14,color:'var(--text-dim)',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{t.artist}</div>
                  </div>
                  <button onClick={e=>{e.stopPropagation();p.removeFromQueue(t.id)}}
                    style={{color:'var(--text-muted)',fontSize:22,padding:'4px 10px',borderRadius:8,background:'none',border:'none',cursor:'pointer',flexShrink:0}}>✕</button>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* TV Scroll Buttons — big fixed up/down arrows on right side */}
      <div style={{
        position:'fixed', right:14, bottom:110, zIndex:90,
        display:'flex', flexDirection:'column', gap:10,
        pointerEvents:'none',
      }}>
        <button
          onPointerDown={e=>{ e.preventDefault(); const el=scrollRef.current; if(!el) return; const iv=setInterval(()=>el.scrollBy({top:-220}),120); (e.currentTarget as any)._iv=iv }}
          onPointerUp={e=>{ clearInterval((e.currentTarget as any)._iv) }}
          onPointerLeave={e=>{ clearInterval((e.currentTarget as any)._iv) }}
          style={{
            width:64, height:64, borderRadius:18,
            background:'rgba(232,255,71,0.18)', border:'2px solid rgba(232,255,71,0.5)',
            color:'var(--accent)', fontSize:30, fontWeight:900,
            display:'flex', alignItems:'center', justifyContent:'center',
            cursor:'pointer', pointerEvents:'all',
            boxShadow:'0 4px 20px rgba(0,0,0,0.5)',
            backdropFilter:'blur(8px)',
          }}>▲</button>
        <button
          onPointerDown={e=>{ e.preventDefault(); const el=scrollRef.current; if(!el) return; const iv=setInterval(()=>el.scrollBy({top:220}),120); (e.currentTarget as any)._iv=iv }}
          onPointerUp={e=>{ clearInterval((e.currentTarget as any)._iv) }}
          onPointerLeave={e=>{ clearInterval((e.currentTarget as any)._iv) }}
          style={{
            width:64, height:64, borderRadius:18,
            background:'rgba(232,255,71,0.18)', border:'2px solid rgba(232,255,71,0.5)',
            color:'var(--accent)', fontSize:30, fontWeight:900,
            display:'flex', alignItems:'center', justifyContent:'center',
            cursor:'pointer', pointerEvents:'all',
            boxShadow:'0 4px 20px rgba(0,0,0,0.5)',
            backdropFilter:'blur(8px)',
          }}>▼</button>
      </div>

      <PlayerBar/>
    </div>
  )
}

// ─── App Root ─────────────────────────────────────────────────────────────────
export default function App({Component,pageProps}:AppProps){
  return(
    <PlayerProvider>
      <Head>
        <title>SonicWave</title>
        <meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no,viewport-fit=cover"/>
        <meta name="theme-color" content="#0a0a0f"/>
        <meta name="description" content="AI-powered music player"/>
        <meta name="mobile-web-app-capable" content="yes"/>
        <meta name="apple-mobile-web-app-capable" content="yes"/>
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent"/>
        <meta name="apple-mobile-web-app-title" content="SonicWave"/>
        <link rel="manifest" href="/manifest.json"/>
        <link rel="apple-touch-icon" href="/icon-192.png"/>
      </Head>
      <MainApp/>
    </PlayerProvider>
  )
}
