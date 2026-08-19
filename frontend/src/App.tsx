import { useState, useEffect } from 'react';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';

export interface UserProfile {
  id: number;
  email: string;
  name: string;
  avatar?: string;
}

function App() {
  const [token, setToken] = useState<string | null>(localStorage.getItem('token'));
  const [user, setUser] = useState<UserProfile | null>(null);

  useEffect(() => {
    const savedUser = localStorage.getItem('user');
    if (savedUser) {
      try {
        setUser(JSON.parse(savedUser));
      } catch (e) {
        console.error('Failed to parse saved user profiles:', e);
      }
    }
  }, []);

  const handleLoginSuccess = (newToken: string, profile: UserProfile) => {
    localStorage.setItem('token', newToken);
    localStorage.setItem('user', JSON.stringify(profile));
    setToken(newToken);
    setUser(profile);
  };

  const handleLogout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    setToken(null);
    setUser(null);
  };

  return (
    <div className="min-h-screen">
      {token && user ? (
        <Dashboard token={token} user={user} onLogout={handleLogout} />
      ) : (
        <Login onLoginSuccess={handleLoginSuccess} />
      )}
    </div>
  );
}

export default App;
