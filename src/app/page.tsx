export default function Home() {
  return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', background: '#111', color: '#fff', fontFamily: 'system-ui' }}>
      <div style={{ textAlign: 'center' }}>
        <h1 style={{ fontSize: 48, color: '#FFD700' }}>Winner Explosion</h1>
        <p style={{ fontSize: 18, color: '#aaa', marginTop: 12 }}>
          Use <code style={{ background: '#333', padding: '2px 8px', borderRadius: 4 }}>/winner</code> as your OBS Browser Source
        </p>
        <p style={{ fontSize: 14, color: '#666', marginTop: 8 }}>
          1080x1920 portrait overlay for Whatnot streams
        </p>
      </div>
    </div>
  );
}
