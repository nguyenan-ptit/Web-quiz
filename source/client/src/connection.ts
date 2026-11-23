import { previewConnection, previewEnabled } from './preview';

export type User = { userId: number; displayName: string; isGuest: boolean };
export type Member = User & { online: boolean };
export type Room = { roomId: string; roomCode: string; title: string; status: string; visibility: string; hasPassword: boolean; hostUserId: number; maxPlayers: number; memberCount: number; members: Member[]; roomVersion: number };
export type Event = { type: string; requestId: string | null; serverTime: number; payload: any };
export type State = { user: User | null; room: Room | null; status: 'idle'|'connecting'|'connected'|'reconnecting'|'expired'|'replaced'; message: string; pending: boolean };
type Pending = { frame: string; resolve: () => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> };
export class RoomConnection {
  private state: State = {user:null,room:null,status:'idle',message:'',pending:false};
  private listeners = new Set<() => void>();
  private socket?: WebSocket;
  private token = '';
  private stopped = true;
  private retry = 0;
  private retryTimer?: ReturnType<typeof setTimeout>;
  private heartbeat?: ReturnType<typeof setInterval>;
  private shutdown?: ReturnType<typeof setTimeout>;
  private pending = new Map<string, Pending>();
  getSnapshot = () => this.state;
  subscribe = (fn: () => void) => {
    clearTimeout(this.shutdown); this.listeners.add(fn);
    return () => { this.listeners.delete(fn); if (!this.listeners.size) this.shutdown=setTimeout(()=>this.stop(),0); };
  };
  private update(patch: Partial<State>) { this.state={...this.state,...patch}; this.listeners.forEach(f=>f()); }
  message(message: string) { this.update({message}); }
  start(token: string, user: User) {
    if (!this.stopped && this.token===token) return;
    this.stop(); this.token=token; this.stopped=false; this.retry=0;
    this.update({user,room:null,message:'',status:'connecting'}); this.connect();
  }
  private connect() {
    if(this.stopped) return;
    const ws=new WebSocket(`${location.protocol==='https:'?'wss:':'ws:'}//${location.host}/ws`); this.socket=ws;
    let authed=false;
    ws.onopen=()=>{ if(this.socket!==ws) return; ws.send(JSON.stringify({type:'AUTH',requestId:crypto.randomUUID(),payload:{token:this.token}})); };
    ws.onmessage=({data})=>{
      if(this.socket!==ws || this.stopped) return;
      let e: Event; try { e=JSON.parse(data); } catch { return; }
      if(e.type==='AUTH_OK') {
        authed=true; this.retry=0; this.update({user:e.payload,status:'connected'});
        this.heartbeat=setInterval(()=>{if(ws.readyState===WebSocket.OPEN) ws.send(JSON.stringify({type:'PING',requestId:crypto.randomUUID(),payload:{}}));},10000);
        this.pending.forEach(p=>ws.send(p.frame));
      } else if(e.type==='ROOM_STATE'||e.type==='ROOM_UPDATED') {
        const next=e.payload as Room; const current=this.state.room;
        if(!current || current.roomId!==next.roomId || next.roomVersion>=current.roomVersion) this.update({room:next});
      } else if(['ROOM_LEFT','ROOM_CLOSED','MEMBER_KICKED'].includes(e.type)) {
        if(!this.state.room || !e.payload.roomId || e.payload.roomId===this.state.room.roomId) this.update({room:null,message:e.payload.reason});
      } else if(e.type==='SESSION_REPLACED') { this.terminal('replaced','Kết nối bị thay thế bởi cửa sổ khác.'); }
      else if(e.type==='ERROR') {
        this.update({message:e.payload.message});
        if(e.payload.code==='UNAUTHENTICATED') this.terminal('expired',e.payload.message);
      }
      if(e.requestId) {
        const p=this.pending.get(e.requestId);
        if(p) { clearTimeout(p.timer); this.pending.delete(e.requestId); this.update({pending:this.pending.size>0}); if(e.type==='ERROR') p.reject(new Error(e.payload.message)); else p.resolve(); }
      }
    };
    ws.onerror=()=>ws.close();
    ws.onclose=(e)=>{
      if(this.socket!==ws || this.stopped) return;
      clearInterval(this.heartbeat);
      if(e.code===4002) { this.terminal('replaced','Kết nối bị thay thế bởi cửa sổ khác.'); return; }
      if(e.code===4001) { this.terminal('expired','Phiên không còn hợp lệ. Vui lòng đăng nhập lại.'); return; }
      this.update({status:'reconnecting',...(!authed?{message:'Chưa kết nối được máy chủ. Đang thử lại…'}:{})});
      this.retryTimer=setTimeout(()=>this.connect(),Math.min(1000*2**this.retry++,8000));
    };
  }
  private terminal(status: 'expired'|'replaced',message: string) {
    this.stop(); this.update({status,message,room:null});
    if(status==='expired') localStorage.removeItem('quiz.token');
  }
  stop() {
    this.stopped=true; clearTimeout(this.retryTimer); clearInterval(this.heartbeat);
    const s=this.socket; this.socket=undefined; s?.close();
    this.pending.forEach(p=>{clearTimeout(p.timer);p.reject(new Error('Kết nối đã kết thúc.'));});this.pending.clear();
    this.update({pending:false});
  }
  send(type: string,payload: object = {}) {
    if(this.state.status!=='connected'||this.socket?.readyState!==WebSocket.OPEN) return Promise.reject(new Error('Vui lòng chờ kết nối được khôi phục.'));
    if(this.pending.size) return Promise.reject(new Error('Đang xử lý yêu cầu trước đó.'));
    const id=crypto.randomUUID(),frame=JSON.stringify({type,requestId:id,payload});
    this.update({message:'',pending:true});
    return new Promise<void>((resolve,reject)=>{
      const timer=setTimeout(()=>{this.pending.delete(id);this.update({pending:false,message:'Chưa nhận được phản hồi. Kiểm tra trạng thái phòng trước khi thử lại.'});reject(new Error('Hết thời gian chờ phản hồi.'));},30000);
      this.pending.set(id,{frame,resolve,reject,timer}); this.socket!.send(frame);
    });
  }
}
export const connection=previewEnabled ? previewConnection : new RoomConnection();
window.addEventListener('pagehide',()=>connection.stop());
