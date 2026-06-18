import { useNavigate } from 'react-router-dom';

export function LandingPage() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center px-4">
      <div className="w-full max-w-2xl">
        {/* Header */}
        <div className="text-center mb-10">
          <p className="text-xs font-semibold uppercase tracking-widest text-brand-500 mb-2">DIGIT</p>
          <h1 className="text-3xl font-bold text-slate-900 mb-3">Accessibility Scanner</h1>
          <p className="text-slate-500 text-base">
            Audit your government digital services for accessibility compliance.
          </p>
        </div>

        {/* Cards */}
        <div className="grid sm:grid-cols-2 gap-5">
          <RoleCard
            icon={<ScanIcon />}
            title="Use the Tool"
            description="Run accessibility scans on any URL. No login required."
            action="Start Scanning"
            onClick={() => navigate('/tool')}
            primary
          />
          <RoleCard
            icon={<AdminIcon />}
            title="Admin Login"
            description="Manage scheduled scans, projects, and email notifications."
            action="Go to Admin"
            onClick={() => navigate('/admin/login')}
          />
        </div>
      </div>
    </div>
  );
}

function RoleCard({ icon, title, description, action, onClick, primary }) {
  return (
    <button
      onClick={onClick}
      className={`group flex flex-col items-start gap-4 p-6 rounded-xl border text-left transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ${
        primary
          ? 'bg-brand-600 border-brand-600 text-white hover:bg-brand-700 shadow-md hover:shadow-lg'
          : 'bg-white border-slate-200 text-slate-900 hover:border-brand-300 hover:shadow-md'
      }`}
    >
      <span className={`p-2.5 rounded-lg ${primary ? 'bg-brand-500' : 'bg-brand-50'}`}>
        <span className={primary ? 'text-white' : 'text-brand-600'}>{icon}</span>
      </span>
      <div className="flex-1">
        <p className={`font-semibold text-base mb-1 ${primary ? 'text-white' : 'text-slate-900'}`}>{title}</p>
        <p className={`text-sm leading-relaxed ${primary ? 'text-brand-100' : 'text-slate-500'}`}>{description}</p>
      </div>
      <span className={`text-sm font-medium flex items-center gap-1.5 ${primary ? 'text-white' : 'text-brand-600'}`}>
        {action}
        <ArrowRightIcon />
      </span>
    </button>
  );
}

function ScanIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <circle cx="11" cy="11" r="8" />
      <path d="M21 21l-4.35-4.35" strokeLinecap="round" />
      <path d="M11 8v6M8 11h6" strokeLinecap="round" />
    </svg>
  );
}

function AdminIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  );
}

function ArrowRightIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M5 12h14M12 5l7 7-7 7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
