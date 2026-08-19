import { useState } from 'react';
import { GoogleLogin } from '@react-oauth/google';
import axios from 'axios';
import { Mail, ShieldCheck, Zap, AlertTriangle } from 'lucide-react';
import type { UserProfile } from '../App';

interface LoginProps {
  onLoginSuccess: (token: string, user: UserProfile) => void;
}

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';

function Login({ onLoginSuccess }: LoginProps) {
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Handle successful Google Authentication
  const handleGoogleSuccess = async (credentialResponse: any) => {
    setLoading(true);
    setError(null);
    try {
      const response = await axios.post(`${API_URL}/auth/google`, {
        idToken: credentialResponse.credential,
      });
      onLoginSuccess(response.data.token, response.data.user);
    } catch (err: any) {
      console.error(err);
      setError(err.response?.data?.error || 'Authentication with backend failed.');
    } finally {
      setLoading(false);
    }
  };


  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(99,102,241,0.05)_0,transparent_100%)] pointer-events-none" />

      <div className="w-full max-w-4xl grid md:grid-cols-2 rounded-2xl overflow-hidden glass-panel shadow-2xl relative z-10 animate-fade-in">
        {/* Left Side: Brand Promo */}
        <div className="p-10 bg-gradient-to-br from-indigo-950/80 to-purple-950/80 flex flex-col justify-between border-r border-white/5">
          <div>
            <div className="flex items-center gap-2 mb-6">
              <div className="bg-accent-violet p-2 rounded-lg">
                <Zap className="h-6 w-6 text-white" />
              </div>
              <span className="font-extrabold text-2xl tracking-wider text-white">
                REACH<span className="text-accent-violet">INBOX</span>
              </span>
            </div>

            <h1 className="text-3xl font-bold tracking-tight mb-4 text-white">
              Transform Cold Email Outreach with <span className="text-accent-violet">AI-Driven</span> Workflows
            </h1>
            <p className="text-slate-400 text-sm leading-relaxed mb-8">
              ReachInbox is an all-in-one solution that empowers businesses to find, enrich, and engage high-intent leads through cold email automation.
            </p>

            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <ShieldCheck className="h-5 w-5 text-accent-success" />
                <span className="text-sm text-slate-300">BullMQ Persistent Scheduling</span>
              </div>
              <div className="flex items-center gap-3">
                <Mail className="h-5 w-5 text-accent-blue" />
                <span className="text-sm text-slate-300">SMTP Integration via Ethereal</span>
              </div>
              <div className="flex items-center gap-3">
                <Zap className="h-5 w-5 text-accent-purple" />
                <span className="text-sm text-slate-300">Hourly Rate Limit & Delay Throttling</span>
              </div>
            </div>
          </div>

          <div className="text-xs text-slate-500 mt-8">
            ReachInbox Labs Assignment © {new Date().getFullYear()}
          </div>
        </div>

        {/* Right Side: Authentication */}
        <div className="p-10 flex flex-col justify-center bg-black/40">
          <div className="mb-8">
            <h2 className="text-2xl font-bold text-white mb-2">Welcome Back</h2>
            <p className="text-slate-400 text-sm">
              Please sign in using your Google Account to access the Scheduler Dashboard.
            </p>
          </div>

          {error && (
            <div className="mb-6 p-4 rounded-lg bg-red-950/50 border border-red-500/30 flex items-start gap-3">
              <AlertTriangle className="h-5 w-5 text-accent-danger shrink-0 mt-0.5" />
              <div className="text-xs text-red-200 leading-normal">{error}</div>
            </div>
          )}

          <div className="space-y-6">
            <div className="flex justify-center">
              {loading ? (
                <div className="flex flex-col items-center gap-3 py-4">
                  <div className="h-8 w-8 border-4 border-accent-violet border-t-transparent rounded-full animate-spin" />
                  <span className="text-xs text-slate-400">Authenticating...</span>
                </div>
              ) : (
                <div className="w-full">
                  <GoogleLogin
                    onSuccess={handleGoogleSuccess}
                    onError={() => setError('Google Sign In failed. Please try again.')}
                    useOneTap
                    theme="filled_black"
                    shape="pill"
                    text="signin_with"
                    width="100%"
                  />
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default Login;
