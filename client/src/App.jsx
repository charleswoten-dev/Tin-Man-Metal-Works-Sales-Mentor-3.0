import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext.jsx';
import Layout from './components/Layout.jsx';
import Auth from './views/Auth.jsx';
import Register from './views/Register.jsx';
import Admin from './views/Admin.jsx';
import TinManIcon from './components/TinManIcon.jsx';
import Chat from './views/Chat.jsx';
import Progress from './views/Progress.jsx';
import Saves from './views/Saves.jsx';
import NicheLibrary from './views/NicheLibrary.jsx';
import WinWall from './views/WinWall.jsx';
import Settings from './views/Settings.jsx';

function Splash() {
  return (
    <div style={{ display: 'grid', placeItems: 'center', height: '100%' }}>
      <TinManIcon size={72} className="splash-pulse" />
    </div>
  );
}

function Root() {
  const { session, loading } = useAuth();

  if (loading) return <Splash />;

  return (
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Routes>
        {/* Admin panel is independent of the user session. */}
        <Route path="/admin" element={<Admin />} />
        {session ? (
          <Route element={<Layout />}>
            <Route index element={<Navigate to="/chat" replace />} />
            <Route path="/chat" element={<Chat />} />
            <Route path="/progress" element={<Progress />} />
            <Route path="/saves" element={<Saves />} />
            <Route path="/niche-library" element={<NicheLibrary />} />
            <Route path="/win-wall" element={<WinWall />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="*" element={<Navigate to="/chat" replace />} />
          </Route>
        ) : (
          <>
            <Route index element={<Register />} />
            <Route path="/register" element={<Register />} />
            <Route path="/signin" element={<Auth />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </>
        )}
      </Routes>
    </BrowserRouter>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <Root />
    </AuthProvider>
  );
}
