// src/components/DebugAuth.jsx
import { useEffect, useState } from "react";
import { auth } from "../firebase/config";

function now() { return new Date().toISOString(); }

export default function DebugAuth() {
  const [logs, setLogs] = useState([]);
  const [ls, setLs] = useState({});
  const [user, setUser] = useState(null);

  useEffect(() => {
    // initialize global logs
    window._gt_logs = window._gt_logs || [];

    const push = (type, args) => {
      const entry = {
        ts: now(),
        type,
        args: Array.from(args).map(a => {
          try { return typeof a === "object" ? JSON.parse(JSON.stringify(a)) : String(a); }
          catch { return String(a); }
        })
      };
      window._gt_logs.push(entry);
      setLogs(prev => [...prev.slice(-199), entry]); // keep last 200
    };

    const orig = { log: console.log, warn: console.warn, error: console.error };
    console.log = (...a) => { push('log', a); orig.log.apply(console, a); };
    console.warn = (...a) => { push('warn', a); orig.warn.apply(console, a); };
    console.error = (...a) => { push('error', a); orig.error.apply(console, a); };

    return () => {
      console.log = orig.log; console.warn = orig.warn; console.error = orig.error;
    };
  }, []);

  const refreshLS = () => {
    const keys = ['gymtracker_login_in_progress', 'firebase_custom_token'];
    const obj = {};
    keys.forEach(k => { try { obj[k] = localStorage.getItem(k); } catch(e){ obj[k] = String(e); } });
    setLs(obj);
  };

  useEffect(() => {
    refreshLS();
    const unsub = auth.onAuthStateChanged(u => {
      setUser(u ? { uid: u.uid, displayName: u.displayName, email: u.email } : null);
    });
    return () => unsub();
  }, []);

  const copyClipboard = async () => {
    const payload = { logs: window._gt_logs || logs, localStorage: ls, user, url: window.location.href };
    try {
      await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
      alert('Trazas copiadas al portapapeles. Pégalas aquí en el chat.');
    } catch (e) {
      alert('No se pudo copiar. Usa Descargar para guardar el JSON.');
    }
  };

  const download = () => {
    const payload = { logs: window._gt_logs || logs, localStorage: ls, user, url: window.location.href };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'gymtracker-debug.json';
    a.click();
  };

  return (
    <div style={{
      position: 'fixed', right: 8, bottom: 8, zIndex: 9999,
      width: 320, maxHeight: '60vh', overflow: 'auto',
      background: 'rgba(255,255,255,0.98)', border: '1px solid #ccc', borderRadius: 8, padding: 8, fontSize: 12
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <strong>DEBUG</strong>
        <div>
          <button onClick={refreshLS} style={{ marginRight: 6 }}>Refresh</button>
          <button onClick={copyClipboard} style={{ marginRight: 6 }}>Copiar</button>
          <button onClick={download}>Descargar</button>
        </div>
      </div>

      <div style={{ marginBottom: 6 }}>
        <strong>URL:</strong>
        <div style={{ wordBreak: 'break-all' }}>{window.location.href}</div>
      </div>

      <div style={{ marginBottom: 6 }}>
        <strong>Auth user:</strong>
        <pre style={{ whiteSpace: 'pre-wrap' }}>{user ? JSON.stringify(user, null, 2) : 'no user'}</pre>
      </div>

      <div style={{ marginBottom: 6 }}>
        <strong>localStorage:</strong>
        <pre style={{ whiteSpace: 'pre-wrap' }}>{JSON.stringify(ls, null, 2)}</pre>
      </div>

      <div>
        <strong>Últimas trazas (máx 200):</strong>
        <div style={{ maxHeight: 180, overflow: 'auto', borderTop: '1px solid #eee', paddingTop: 6 }}>
          {(window._gt_logs || logs).slice().reverse().map((l, i) => (
            <div key={i} style={{ marginBottom: 6 }}>
              <div style={{ color: l.type === 'error' ? '#b00020' : l.type === 'warn' ? '#b36a00' : '#111' }}>
                [{l.ts}] {l.type}
              </div>
              <pre style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{JSON.stringify(l.args, null, 2)}</pre>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}