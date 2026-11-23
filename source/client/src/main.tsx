import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import { connection, User } from './connection';
import { previewConnection, previewEnabled, PreviewView } from './preview';
import './style.css';

async function api(path: string, body?: object, token?: string) {
  if (previewEnabled) throw new Error('Chế độ xem trước không kết nối backend.');
  const response=await fetch('/api/auth/'+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},...(body?{body:JSON.stringify(body)}:{})});
  const result=await response.json();
  if(!response.ok) throw Object.assign(new Error(result.message||'Không thể xử lý yêu cầu.'),{status:response.status});
  return result;
}
// One restoration request and one socket for the tab, including React StrictMode effect replay.
let restoration: Promise<void>|undefined;
function restore() {
  if (previewEnabled) return Promise.resolve();
  if(!restoration) restoration=(async()=>{
    const token=localStorage.getItem('quiz.token'); if(!token) return;
    try { const user=await api('me',undefined,token) as User; connection.start(token,user); }
    catch(e) { const error=e as Error & {status?:number}; if(error.status===401) localStorage.removeItem('quiz.token'); connection.message(error.status===401?'Phiên đã hết hạn. Vui lòng đăng nhập lại.':'Không thể khôi phục phiên. Hãy kiểm tra mạng và tải lại trang.'); }
  })();
  return restoration;
}
function App() {
  const state=useSyncExternalStore(connection.subscribe,connection.getSnapshot);
  const submitting=useRef(false);
  const [booting,setBooting]=useState(true),[busy,setBusy]=useState(false),[mode,setMode]=useState<'guest'|'login'>('guest');
  const [name,setName]=useState(previewEnabled ? 'Minh Anh' : localStorage.getItem('quiz.name')||''),[username,setUsername]=useState(''),[password,setPassword]=useState('');
  const [title,setTitle]=useState('Phòng ôn tập'),[visibility,setVisibility]=useState('PRIVATE'),[roomPassword,setRoomPassword]=useState(''),[maxPlayers,setMaxPlayers]=useState(20);
  const [code,setCode]=useState(''),[joinPassword,setJoinPassword]=useState(''),[copied,setCopied]=useState(false);
  useEffect(()=>{void restore().finally(()=>setBooting(false));},[]);
  useEffect(()=>{if(!previewEnabled) localStorage.setItem('quiz.name',name);},[name]);
  useEffect(()=>{if(!copied) return; const timer=setTimeout(()=>setCopied(false),2000);return ()=>clearTimeout(timer);},[copied]);
  const act=async(type:string,payload:object={})=>{try {await connection.send(type,payload);}catch(e){connection.message((e as Error).message);}};
  const identify=async(e:React.FormEvent)=>{
    e.preventDefault(); if(submitting.current) return; submitting.current=true;setBusy(true);connection.message('');
    try {
      if(previewEnabled) {
        const displayName=(mode==='guest'?name:username).trim()||'Minh Anh';
        previewConnection.start('',{userId:1,displayName,isGuest:mode==='guest'});
        setPassword('');if(!name) setName(displayName);return;
      }
      const result=await api(mode==='guest'?'guest':'login',mode==='guest'?{displayName:name}:{username,password});localStorage.setItem('quiz.token',result.token);connection.start(result.token,result.user);setPassword('');if(!name) setName(result.user.displayName);}
    catch(e){connection.message((e as Error).message);}finally{submitting.current=false;setBusy(false);}
  };
  const room=state.room, user=state.user, host=room?.hostUserId===user?.userId;
  const disabled=state.pending||state.status!=='connected';
  const terminal=state.status==='expired'||state.status==='replaced';
  const showPreview=(view:PreviewView)=>{setName('Minh Anh');setMode('guest');setPassword('');setCopied(false);previewConnection.show(view);};
  return <main>
    {previewEnabled&&<nav className="preview-bar" aria-label="Chọn màn hình xem trước">
      <div><strong>Xem trước giao diện</strong><span>Dữ liệu giả · Không kết nối BE · Không cần tài khoản</span></div>
      <div className="preview-actions">
        <button onClick={()=>showPreview('entry')}>Nhập tên / Đăng nhập</button>
        <button onClick={()=>showPreview('user')}>Tạo / Vào phòng</button>
        <button onClick={()=>showPreview('guest')}>Giao diện khách</button>
        <button onClick={()=>showPreview('host-room')}>Phòng chờ · Chủ phòng</button>
        <button onClick={()=>showPreview('member-room')}>Phòng chờ · Thành viên</button>
      </div>
    </nav>}
    <header><a className="brand" href="/" aria-label="Quiz trang chủ"><span className="brand-icon">Q</span>quiz<span className="brand-dot">.</span></a><span className="eyebrow">CÙNG NHAU HỌC TỐT HƠN</span><span className={'connection '+(state.status==='connected'?'live':'')}>{previewEnabled?'Dữ liệu mẫu':({idle:'Chưa kết nối',connecting:'Đang kết nối',connected:'Đã kết nối',reconnecting:'Đang kết nối lại',expired:'Mất phiên',replaced:'Đã thay kết nối'})[state.status]}</span></header>
    {state.message&&<div className="notice" role="status">{state.message}</div>}
    {state.status==='reconnecting'&&<div className="notice">Đang thử kết nối lại. Chỗ trong phòng được giữ 30 giây kể từ khi máy chủ phát hiện mất kết nối.</div>}
    {terminal?<section className="card terminal"><h1>{state.status==='replaced'?'Bạn đã kết nối ở nơi khác':'Phiên đã kết thúc'}</h1><p>{state.status==='replaced'?'Mỗi tài khoản có một cửa sổ điều khiển phòng. Tải lại trang để tiếp tục tại đây.':'Đăng nhập lại để tiếp tục sử dụng Quiz.'}</p><button onClick={()=>location.reload()}>Tiếp tục tại đây</button></section>:
    booting?<section className="card"><p>Đang khôi phục phiên…</p></section>:
    !user?<div className="entry-grid"><section className="intro"><span className="pill">PHÒNG & NGƯỜI CHƠI</span><h1>Một phòng học.<br/><em>Nhiều đồng đội.</em></h1><p>Chọn tên của bạn, chia sẻ mã phòng và cùng nhau sẵn sàng cho buổi ôn tập.</p><div className="illustration" aria-hidden="true"><span className="tile one">An <i>●</i></span><span className="tile two">Bình <i>●</i></span><span className="tile three">Bạn <i>★</i></span><div className="orbit">Q</div></div><p className="small">Khách có thể vào phòng bằng mã. Đăng nhập tài khoản để tạo phòng của riêng bạn.</p></section>
      <section className="card auth"><span className="eyebrow">BẮT ĐẦU TẠI ĐÂY</span><h2>Bạn là ai hôm nay?</h2><div className="tabs"><button className={mode==='guest'?'selected':''} onClick={()=>setMode('guest')}>Tham gia với tên</button><button className={mode==='login'?'selected':''} onClick={()=>setMode('login')}>Đăng nhập</button></div><form onSubmit={identify}>{mode==='guest'?<label>Tên hiển thị<input autoComplete="nickname" maxLength={50} value={name} onChange={e=>setName(e.target.value)} placeholder="Ví dụ: Minh Anh" required/><small>Tên mọi người sẽ thấy trong phòng.</small></label>:<><label>Tên đăng nhập<input autoComplete="username" placeholder={previewEnabled?'Nhập tên bất kỳ':undefined} value={username} onChange={e=>setUsername(e.target.value)} maxLength={50} required={!previewEnabled}/></label><label>Mật khẩu<input type="password" autoComplete="current-password" value={password} onChange={e=>setPassword(e.target.value)} maxLength={72} required={!previewEnabled} placeholder={previewEnabled?'Không cần mật khẩu khi xem trước':undefined}/></label></>}<button className="primary" disabled={busy}>{busy?'Đang xử lý…':mode==='guest'?'Tiếp tục với tên này →':'Đăng nhập →'}</button></form></section></div>:
    room?<>
      <div className="page-heading"><div><span className="eyebrow">PHÒNG CHỜ · {room.visibility==='PRIVATE'?'RIÊNG TƯ':'CÔNG KHAI'}{room.hasPassword?' · CÓ MẬT KHẨU':''}</span><h1>{room.title}</h1><p>Mọi người đã ở đây. Hãy chia sẻ mã để mời thêm bạn bè.</p></div><button className="secondary" disabled={disabled} onClick={()=>void act('LEAVE_ROOM')}>Rời phòng ↗</button></div>
      <div className="lobby-grid"><section className="card members"><div className="section-heading"><h2>Người trong phòng <span className="count">{room.memberCount}/{room.maxPlayers}</span></h2><span className="small">{room.members.filter(m=>m.online).length} trực tuyến</span></div><ul>{room.members.map((m,index)=><li key={m.userId}><span className={'avatar color'+index%4}>{Array.from(m.displayName)[0]?.toUpperCase()}</span><div className="member-info"><strong>{m.displayName} {m.userId===user.userId&&<span className="you">(bạn)</span>}</strong><span className="small"><i className={'dot '+(m.online?'online':'')}/>{m.online?'Trực tuyến':'Đang chờ kết nối lại'}{m.isGuest?' · Khách':''}</span></div>{m.userId===room.hostUserId?<span className="host-badge">★ Chủ phòng</span>:host&&<div className="member-actions">{!m.isGuest&&m.online&&<button className="text-button" disabled={disabled} onClick={()=>{if(confirm(`Chuyển quyền chủ phòng cho ${m.displayName}?`)) void act('TRANSFER_HOST',{targetUserId:m.userId});}}>Chuyển quyền</button>}<button className="text-button danger" disabled={disabled} onClick={()=>{if(confirm(`Mời ${m.displayName} ra khỏi phòng? Người này sẽ không thể vào lại phòng này.`)) void act('KICK_MEMBER',{targetUserId:m.userId});}}>Mời ra</button></div>}</li>)}</ul></section>
      <aside><section className="card invite"><span className="eyebrow">MỜI BẠN BÈ</span><h2>Mã phòng của bạn</h2><div className="room-code">{room.roomCode}</div><button className="primary" onClick={()=>{navigator.clipboard.writeText(room.roomCode).then(()=>{setCopied(true);}).catch(()=>connection.message('Không sao chép được. Bạn có thể chọn mã phòng để sao chép thủ công.'));}}>{copied?'Đã sao chép ✓':'Sao chép mã phòng'}</button><p className="small">Gửi mã 6 ký tự này cho người bạn muốn mời.</p></section><section className="room-note"><span>✦</span><div><strong>Không gian đã sẵn sàng</strong><p>Đây là phòng chờ. Tính năng chạy trận sẽ được bổ sung ở giai đoạn tiếp theo.</p></div></section></aside></div>
    </>:<><div className="page-heading"><div><span className="eyebrow">XIN CHÀO, {user.isGuest?'KHÁCH':'THÀNH VIÊN'}</span><h1>Học cùng nhau, vui hơn.</h1><p>Bạn đang dùng danh tính <strong>{user.displayName}</strong>.</p></div>{user.isGuest&&<button className="secondary" onClick={()=>{if(previewEnabled){previewConnection.stop();setMode('login');return;}connection.stop();localStorage.removeItem('quiz.token');location.reload();}}>Đăng nhập để tạo phòng</button>}</div>
      <label className="display-field">Tên hiển thị trong phòng<input maxLength={50} value={name} onChange={e=>setName(e.target.value)} placeholder="Nhập tên của bạn" required/></label>
      <div className="forms-grid"><section className="card"><span className="step">01 / THAM GIA</span><h2>Có mã? Vào thôi.</h2><p>Vào phòng của bạn bè bằng mã được chia sẻ.</p><form onSubmit={e=>{e.preventDefault();void act('JOIN_ROOM',{roomCode:code.trim().toUpperCase(),displayName:name,password:joinPassword});}}><label>Mã phòng<input className="code-input" value={code} onChange={e=>setCode(e.target.value.toUpperCase())} maxLength={12} placeholder="ABC234" pattern="\s*[A-Za-z0-9]{6}\s*" required autoComplete="off"/></label><label>Mật khẩu phòng <span className="optional">nếu có</span><input type="password" value={joinPassword} onChange={e=>setJoinPassword(e.target.value)} maxLength={72} autoComplete="off"/></label><button className="primary" disabled={disabled||!name.trim()}>{state.pending?'Đang xử lý…':'Vào phòng →'}</button></form></section>
      <section className="card"><span className="step">02 / KHỞI TẠO</span><h2>Mở phòng của riêng bạn.</h2>{user.isGuest?<div className="guest-note"><span>◇</span><h3>Dành cho tài khoản thành viên</h3><p>Đăng nhập để tạo phòng và mời mọi người cùng tham gia.</p></div>:<form onSubmit={e=>{e.preventDefault();void act('CREATE_ROOM',{title,displayName:name,visibility,password:roomPassword,maxPlayers});}}><label>Tên phòng<input value={title} onChange={e=>setTitle(e.target.value)} maxLength={100} required/></label><div className="two-fields"><label>Quyền riêng tư<select value={visibility} onChange={e=>setVisibility(e.target.value)}><option value="PRIVATE">Riêng tư</option><option value="PUBLIC">Công khai</option></select></label><label>Số người tối đa<input type="number" min={2} max={100} value={maxPlayers} onChange={e=>setMaxPlayers(Number(e.target.value))} required/></label></div><label>Mật khẩu phòng <span className="optional">tùy chọn</span><input type="password" value={roomPassword} onChange={e=>setRoomPassword(e.target.value)} maxLength={72} autoComplete="new-password"/></label><button className="primary dark" disabled={disabled||!name.trim()}>{state.pending?'Đang xử lý…':'Tạo phòng mới + '}</button></form>}</section></div></>}
    <footer><span>QUIZ / CÙNG HỌC, CÙNG TIẾN BỘ</span><span>Phòng chờ thời gian thực</span></footer>
  </main>;
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><App/></React.StrictMode>);
