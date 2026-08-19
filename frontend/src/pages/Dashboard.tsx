import { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import Papa from 'papaparse';
import {
  Mail,
  Send,
  Clock,
  AlertCircle,
  Plus,
  LogOut,
  Upload,
  RefreshCw,
  Search,
  CheckCircle2,
  X,
  Sparkles,
  Info
} from 'lucide-react';
import type { UserProfile } from '../App';

interface DashboardProps {
  token: string;
  user: UserProfile;
  onLogout: () => void;
}

interface EmailJob {
  id: string;
  recipient: string;
  subject: string;
  body: string;
  status: 'PENDING' | 'PROCESSING' | 'SENT' | 'FAILED';
  scheduledAt: string;
  sentAt?: string;
  error?: string;
  sender?: {
    email: string;
    name: string;
  };
}

interface Stats {
  PENDING: number;
  PROCESSING: number;
  SENT: number;
  FAILED: number;
  TOTAL: number;
}

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';

function Dashboard({ token, user, onLogout }: DashboardProps) {
  // Stats & Email lists state
  const [stats, setStats] = useState<Stats>({ PENDING: 0, PROCESSING: 0, SENT: 0, FAILED: 0, TOTAL: 0 });
  const [activeTab, setActiveTab] = useState<'scheduled' | 'sent'>('scheduled');
  const [emails, setEmails] = useState<EmailJob[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');

  // Compose Modal state
  const [isComposeOpen, setIsComposeOpen] = useState(false);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [parsedEmails, setParsedEmails] = useState<string[]>([]);
  const [fileError, setFileError] = useState<string | null>(null);
  const [scheduledAt, setScheduledAt] = useState('');
  const [delaySeconds, setDelaySeconds] = useState(2);
  const [hourlyLimit, setHourlyLimit] = useState(200);
  const [submitting, setSubmitting] = useState(false);
  const [submitSuccess, setSubmitSuccess] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Setup Axios auth header
  const authConfig = {
    headers: { Authorization: `Bearer ${token}` },
  };

  // Fetch metrics & list data
  const fetchData = async () => {
    setLoading(true);
    try {
      // Fetch stats
      const statsRes = await axios.get(`${API_URL}/emails/stats`, authConfig);
      setStats(statsRes.data);

      // Fetch active tab emails
      const listEndpoint = activeTab === 'scheduled' ? 'scheduled' : 'sent';
      const emailsRes = await axios.get(`${API_URL}/emails/${listEndpoint}`, authConfig);
      setEmails(emailsRes.data);
    } catch (err) {
      console.error('Failed to fetch data:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [activeTab]);

  const handleRefresh = () => {
    setRefreshing(true);
    fetchData();
  };

  // Parse lead CSV/text file
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    setFileError(null);
    setParsedEmails([]);
    
    if (!file) return;

    Papa.parse(file, {
      skipEmptyLines: true,
      complete: (results) => {
        const foundEmails: string[] = [];
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        
        results.data.forEach((row: any) => {
          const cells = Array.isArray(row) ? row : Object.values(row);
          cells.forEach((cell: any) => {
            const val = String(cell).trim();
            if (emailRegex.test(val)) {
              foundEmails.push(val);
            }
          });
        });

        const uniqueEmails = Array.from(new Set(foundEmails));
        
        if (uniqueEmails.length === 0) {
          setFileError('No valid email addresses detected in the uploaded file.');
        } else {
          setParsedEmails(uniqueEmails);
        }
      },
      error: (err) => {
        console.error(err);
        setFileError('Error reading file. Please upload a valid CSV or TXT file.');
      }
    });
  };

  // Handle composing new email scheduling
  const handleScheduleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitError(null);
    setSubmitSuccess(null);

    if (parsedEmails.length === 0) {
      setSubmitError('Please upload a file containing email leads.');
      return;
    }

    setSubmitting(true);
    try {
      const response = await axios.post(
        `${API_URL}/emails/schedule`,
        {
          subject,
          body,
          recipients: parsedEmails,
          scheduledAt: scheduledAt || new Date().toISOString(),
          delayBetweenSeconds: delaySeconds,
          hourlyLimit: hourlyLimit,
        },
        authConfig
      );

      setSubmitSuccess(response.data.message || 'Emails scheduled successfully!');
      
      // Reset compose state after short delay
      setTimeout(() => {
        setIsComposeOpen(false);
        setSubject('');
        setBody('');
        setParsedEmails([]);
        setScheduledAt('');
        setSubmitSuccess(null);
        fetchData();
      }, 1500);

    } catch (err: any) {
      console.error(err);
      setSubmitError(err.response?.data?.error || 'Failed to schedule emails.');
    } finally {
      setSubmitting(false);
    }
  };

  // Filter emails by search term
  const filteredEmails = emails.filter(
    (e) =>
      e.recipient.toLowerCase().includes(searchTerm.toLowerCase()) ||
      e.subject.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="min-h-screen flex flex-col">
      {/* Header bar */}
      <header className="sticky top-0 z-30 border-b border-white/5 bg-bgDarker/80 backdrop-blur-md">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="bg-accent-violet p-1.5 rounded-lg">
              <Sparkles className="h-5 w-5 text-white" />
            </div>
            <span className="font-extrabold text-xl tracking-wider">
              REACH<span className="text-accent-violet">INBOX</span>
            </span>
          </div>

          <div className="flex items-center gap-4">
            <div className="flex items-center gap-3 bg-white/5 border border-white/5 py-1.5 px-3 rounded-full">
              <img
                src={user.avatar || 'https://lh3.googleusercontent.com/a/default-user'}
                alt={user.name}
                className="h-7 w-7 rounded-full border border-white/10"
              />
              <div className="hidden sm:block text-left">
                <p className="text-xs font-semibold text-white leading-none">{user.name}</p>
                <p className="text-[10px] text-slate-400 leading-none mt-1">{user.email}</p>
              </div>
            </div>

            <button
              onClick={onLogout}
              className="p-2 rounded-lg bg-white/5 border border-white/5 hover:bg-red-950/20 hover:border-red-500/20 text-slate-300 hover:text-accent-danger transition-all duration-200 active:scale-95"
              title="Logout"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
        
        {/* Top actions & stats title */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-white">Email Scheduler Panel</h1>
            <p className="text-xs text-slate-400 mt-1">Configure, schedule, and monitor cold email campaigns.</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleRefresh}
              className="p-2.5 rounded-lg bg-white/5 border border-white/5 hover:bg-white/10 text-slate-300 active:scale-95 transition-all"
              disabled={refreshing}
            >
              <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
            </button>
            <button
              onClick={() => setIsComposeOpen(true)}
              className="glass-button-primary flex items-center gap-2"
            >
              <Plus className="h-4 w-4" />
              Compose New Campaign
            </button>
          </div>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
          <div className="glass-panel p-5 rounded-xl flex items-center gap-4">
            <div className="p-3 rounded-lg bg-accent-violet/10 text-accent-violet">
              <Clock className="h-5 w-5" />
            </div>
            <div>
              <p className="text-xs text-slate-400 uppercase tracking-wider">Scheduled</p>
              <p className="text-2xl font-bold text-white mt-1">{stats.PENDING}</p>
            </div>
          </div>
          
          <div className="glass-panel p-5 rounded-xl flex items-center gap-4">
            <div className="p-3 rounded-lg bg-accent-blue/10 text-accent-blue">
              <RefreshCw className="h-5 w-5 animate-spin" style={{ animationDuration: '3s' }} />
            </div>
            <div>
              <p className="text-xs text-slate-400 uppercase tracking-wider">Processing</p>
              <p className="text-2xl font-bold text-white mt-1">{stats.PROCESSING}</p>
            </div>
          </div>

          <div className="glass-panel p-5 rounded-xl flex items-center gap-4 col-span-1">
            <div className="p-3 rounded-lg bg-accent-success/10 text-accent-success">
              <CheckCircle2 className="h-5 w-5" />
            </div>
            <div>
              <p className="text-xs text-slate-400 uppercase tracking-wider">Sent</p>
              <p className="text-2xl font-bold text-white mt-1">{stats.SENT}</p>
            </div>
          </div>

          <div className="glass-panel p-5 rounded-xl flex items-center gap-4">
            <div className="p-3 rounded-lg bg-accent-danger/10 text-accent-danger">
              <AlertCircle className="h-5 w-5" />
            </div>
            <div>
              <p className="text-xs text-slate-400 uppercase tracking-wider">Failed</p>
              <p className="text-2xl font-bold text-white mt-1">{stats.FAILED}</p>
            </div>
          </div>

          <div className="glass-panel p-5 rounded-xl flex items-center gap-4 col-span-2 lg:col-span-1">
            <div className="p-3 rounded-lg bg-white/5 text-slate-300">
              <Mail className="h-5 w-5" />
            </div>
            <div>
              <p className="text-xs text-slate-400 uppercase tracking-wider">Total Jobs</p>
              <p className="text-2xl font-bold text-white mt-1">{stats.TOTAL}</p>
            </div>
          </div>
        </div>

        {/* Tab & Table Section */}
        <div className="glass-panel rounded-xl overflow-hidden border border-white/5 flex flex-col">
          
          {/* Tabs header & search */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-white/5 p-4 gap-4 bg-white/2">
            <div className="flex gap-2">
              <button
                onClick={() => setActiveTab('scheduled')}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                  activeTab === 'scheduled'
                    ? 'bg-accent-violet/10 text-accent-violet border border-accent-violet/20'
                    : 'text-slate-400 hover:text-white hover:bg-white/5 border border-transparent'
                }`}
              >
                <Clock className="h-4 w-4" />
                Scheduled Queue
              </button>
              <button
                onClick={() => setActiveTab('sent')}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                  activeTab === 'sent'
                    ? 'bg-accent-success/10 text-accent-success border border-accent-success/20'
                    : 'text-slate-400 hover:text-white hover:bg-white/5 border border-transparent'
                }`}
              >
                <Send className="h-4 w-4" />
                Sent Log History
              </button>
            </div>

            <div className="relative">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
              <input
                type="text"
                placeholder="Search by recipient or subject..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="glass-input pl-9 pr-4 py-2 w-full sm:w-64 rounded-lg text-sm"
              />
            </div>
          </div>

          {/* Table list */}
          <div className="overflow-x-auto">
            {loading ? (
              <div className="flex flex-col items-center justify-center py-20 gap-4">
                <div className="h-10 w-10 border-4 border-accent-violet border-t-transparent rounded-full animate-spin" />
                <p className="text-sm text-slate-400">Loading emails...</p>
              </div>
            ) : filteredEmails.length === 0 ? (
              <div className="text-center py-20">
                <Mail className="h-12 w-12 text-slate-600 mx-auto mb-4" />
                <h3 className="text-lg font-semibold text-white">No Emails Found</h3>
                <p className="text-sm text-slate-400 max-w-sm mx-auto mt-1">
                  {searchTerm
                    ? "We couldn't find any results matching your search terms."
                    : activeTab === 'scheduled'
                    ? 'No scheduled email jobs are currently in the queue.'
                    : 'No email sending history has been recorded yet.'}
                </p>
              </div>
            ) : (
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-white/5 text-slate-400 text-xs font-semibold uppercase bg-white/2">
                    <th className="px-6 py-4">Recipient</th>
                    <th className="px-6 py-4">Subject</th>
                    <th className="px-6 py-4">Sender Pool</th>
                    <th className="px-6 py-4">
                      {activeTab === 'scheduled' ? 'Scheduled Send Time' : 'Sent/Failed Time'}
                    </th>
                    <th className="px-6 py-4">Status</th>
                    {activeTab === 'sent' && <th className="px-6 py-4">Delivery Notes</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {filteredEmails.map((email) => (
                    <tr key={email.id} className="hover:bg-white/2 transition-colors text-sm text-slate-300">
                      <td className="px-6 py-4 font-medium text-white">{email.recipient}</td>
                      <td className="px-6 py-4 max-w-xs truncate" title={email.subject}>
                        {email.subject}
                      </td>
                      <td className="px-6 py-4 text-xs">
                        {email.sender ? (
                          <div>
                            <p className="font-semibold text-white leading-none">{email.sender.name}</p>
                            <p className="text-slate-400 mt-1 leading-none">{email.sender.email}</p>
                          </div>
                        ) : (
                          <span className="text-slate-500">Unassigned</span>
                        )}
                      </td>
                      <td className="px-6 py-4 text-xs font-mono">
                        {activeTab === 'scheduled'
                          ? new Date(email.scheduledAt).toLocaleString()
                          : email.sentAt
                          ? new Date(email.sentAt).toLocaleString()
                          : '-'}
                      </td>
                      <td className="px-6 py-4">
                        <span
                          className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ${
                            email.status === 'SENT'
                              ? 'bg-accent-success/15 text-accent-success'
                              : email.status === 'FAILED'
                              ? 'bg-accent-danger/15 text-accent-danger'
                              : email.status === 'PROCESSING'
                              ? 'bg-accent-blue/15 text-accent-blue animate-pulse'
                              : 'bg-accent-warning/15 text-accent-warning'
                          }`}
                        >
                          {email.status}
                        </span>
                      </td>
                      {activeTab === 'sent' && (
                        <td className="px-6 py-4 text-xs max-w-sm break-all">
                          {email.status === 'SENT' && email.error && email.error.includes('Preview URL') ? (
                            <a
                              href={email.error.replace('Preview URL: ', '')}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-accent-blue hover:underline font-semibold flex items-center gap-1"
                            >
                              <Info className="h-3.5 w-3.5" />
                              View Fake Ethereal Email Preview
                            </a>
                          ) : (
                            <span className={email.status === 'FAILED' ? 'text-accent-danger' : 'text-slate-400'}>
                              {email.error || '-'}
                            </span>
                          )}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </main>

      {/* Compose Campaign Modal */}
      {isComposeOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in">
          <div className="w-full max-w-3xl glass-panel rounded-2xl overflow-hidden shadow-2xl flex flex-col max-h-[90vh] animate-slide-up">
            
            {/* Modal Header */}
            <div className="flex items-center justify-between p-6 border-b border-white/5 bg-white/2">
              <div className="flex items-center gap-2">
                <Plus className="h-5 w-5 text-accent-violet" />
                <h2 className="text-xl font-bold text-white">Compose New Email Campaign</h2>
              </div>
              <button
                onClick={() => {
                  setIsComposeOpen(false);
                  setSubmitError(null);
                  setSubmitSuccess(null);
                }}
                className="p-1 rounded-lg hover:bg-white/10 text-slate-400 hover:text-white transition-all"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Modal Form Scrollable Area */}
            <form onSubmit={handleScheduleSubmit} className="flex-1 overflow-y-auto p-6 space-y-6">
              
              {submitSuccess && (
                <div className="p-4 rounded-lg bg-emerald-950/50 border border-emerald-500/30 flex items-start gap-3">
                  <CheckCircle2 className="h-5 w-5 text-accent-success shrink-0 mt-0.5" />
                  <div className="text-sm text-emerald-200 leading-normal">{submitSuccess}</div>
                </div>
              )}

              {submitError && (
                <div className="p-4 rounded-lg bg-red-950/50 border border-red-500/30 flex items-start gap-3">
                  <AlertCircle className="h-5 w-5 text-accent-danger shrink-0 mt-0.5" />
                  <div className="text-sm text-red-200 leading-normal">{submitError}</div>
                </div>
              )}

              {/* Subject */}
              <div className="space-y-2">
                <label className="block text-sm font-semibold text-slate-300">Email Subject</label>
                <input
                  type="text"
                  placeholder="e.g. ReachInbox.ai Partnership Proposal"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  className="w-full glass-input px-4 py-3 rounded-lg text-sm text-white"
                  required
                />
              </div>

              {/* Body */}
              <div className="space-y-2">
                <label className="block text-sm font-semibold text-slate-300">Email Body</label>
                <textarea
                  placeholder="Hello,\n\nI wanted to reach out regarding Outbox Labs..."
                  rows={6}
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  className="w-full glass-input px-4 py-3 rounded-lg text-sm text-white font-sans whitespace-pre-line"
                  required
                />
              </div>

              {/* File Upload (CSV Leads) */}
              <div className="space-y-2">
                <label className="block text-sm font-semibold text-slate-300">Upload Leads (CSV/Text)</label>
                <div className="flex flex-col items-center justify-center p-6 border border-dashed border-white/15 hover:border-accent-violet/50 rounded-lg bg-white/2 cursor-pointer transition-colors relative">
                  <input
                    type="file"
                    accept=".csv,.txt"
                    onChange={handleFileUpload}
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                    ref={fileInputRef}
                  />
                  <Upload className="h-8 w-8 text-slate-400 mb-2" />
                  <p className="text-sm text-slate-300">Click or drag CSV/TXT file here</p>
                  <p className="text-[10px] text-slate-500 mt-1">Accepts multiple columns, parses all valid emails</p>
                </div>
                
                {fileError && <p className="text-xs text-accent-danger">{fileError}</p>}
                
                {parsedEmails.length > 0 && (
                  <div className="p-3 rounded-lg bg-accent-success/15 border border-accent-success/20 flex items-center justify-between text-xs text-slate-200">
                    <span className="font-semibold flex items-center gap-1.5 text-accent-success">
                      <CheckCircle2 className="h-4 w-4" />
                      Parsed {parsedEmails.length} unique email addresses.
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        setParsedEmails([]);
                        if (fileInputRef.current) fileInputRef.current.value = '';
                      }}
                      className="text-slate-400 hover:text-white"
                    >
                      Clear
                    </button>
                  </div>
                )}
              </div>

              {/* Scheduling Settings */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-4 border-t border-white/5">
                
                {/* Start Date-Time */}
                <div className="space-y-2">
                  <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider">
                    Start Sending Time
                  </label>
                  <input
                    type="datetime-local"
                    value={scheduledAt}
                    onChange={(e) => setScheduledAt(e.target.value)}
                    className="w-full glass-input px-3 py-2 rounded-lg text-sm text-white"
                  />
                  <p className="text-[10px] text-slate-500">Leave blank to start immediately</p>
                </div>

                {/* Delay between sends */}
                <div className="space-y-2">
                  <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider">
                    Delay Between Emails (sec)
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={60}
                    value={delaySeconds}
                    onChange={(e) => setDelaySeconds(parseInt(e.target.value) || 2)}
                    className="w-full glass-input px-3 py-2 rounded-lg text-sm text-white"
                    required
                  />
                  <p className="text-[10px] text-slate-500">Prevents provider spam throttling</p>
                </div>

                {/* Hourly rate limit */}
                <div className="space-y-2">
                  <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider">
                    Hourly Limit (per sender)
                  </label>
                  <input
                    type="number"
                    min={1}
                    value={hourlyLimit}
                    onChange={(e) => setHourlyLimit(parseInt(e.target.value) || 200)}
                    className="w-full glass-input px-3 py-2 rounded-lg text-sm text-white"
                    required
                  />
                  <p className="text-[10px] text-slate-500">Exceeded sends delay to next hour</p>
                </div>

              </div>

            </form>

            {/* Modal Footer */}
            <div className="p-6 border-t border-white/5 bg-white/2 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => {
                  setIsComposeOpen(false);
                  setSubmitError(null);
                  setSubmitSuccess(null);
                }}
                className="glass-button-secondary text-sm"
                disabled={submitting}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleScheduleSubmit}
                className="glass-button-primary text-sm flex items-center gap-2"
                disabled={submitting || parsedEmails.length === 0}
              >
                {submitting ? (
                  <>
                    <div className="h-4 w-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    Scheduling...
                  </>
                ) : (
                  <>
                    <Send className="h-4 w-4" />
                    Schedule Campaign
                  </>
                )}
              </button>
            </div>

          </div>
        </div>
      )}
    </div>
  );
}

export default Dashboard;
