import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { getProjects, deleteProject, toggleProjectStatus, getSettings } from '../../lib/adminStore.js';
import { syncSchedule, clearProjectData } from '../../lib/api.js';

export function AdminProjects() {
  const navigate = useNavigate();
  const [projects,      setProjects]      = useState([]);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [deleteError,   setDeleteError]   = useState(null);

  const reload = () => setProjects(getProjects());
  useEffect(reload, []);

  const handleToggle = (id) => { toggleProjectStatus(id); reload(); };
  const handleDelete = async (id) => {
    const project = projects.find((p) => p.id === id);
    deleteProject(id);
    setConfirmDelete(null);
    setDeleteError(null);
    reload();
    const remaining = getProjects();
    try {
      await clearProjectData(id, project?.name);
      await syncSchedule({ projects: remaining, settings: getSettings(), frontendUrl: window.location.origin });
    } catch {
      setDeleteError('Project removed locally but the server could not be notified — restart the API if scheduled scans continue for this project.');
    }
  };

  return (
    <div className="p-8">
      {/* Page header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Projects</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            {projects.length} project{projects.length !== 1 ? 's' : ''} configured
          </p>
        </div>
        <button
          onClick={() => navigate('/admin/projects/new')}
          className="btn-primary inline-flex items-center gap-2"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
            <path d="M12 5v14M5 12h14" strokeLinecap="round" />
          </svg>
          Add Project
        </button>
      </div>

      {deleteError && (
        <div className="mb-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
          <p className="text-sm text-amber-800">{deleteError}</p>
        </div>
      )}

      {/* Empty state */}
      {projects.length === 0 && (
        <div className="card text-center py-16">
          <div className="text-4xl mb-4" aria-hidden="true">📋</div>
          <h2 className="text-lg font-semibold text-slate-900">No projects yet</h2>
          <p className="text-sm text-slate-500 mt-1 mb-6 max-w-sm mx-auto">
            Add a project to start scheduling automated accessibility scans and report delivery.
          </p>
          <button onClick={() => navigate('/admin/projects/new')} className="btn-primary">
            Add Project
          </button>
        </div>
      )}

      {/* Project table */}
      {projects.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-card overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <Th>Project</Th>
                <Th>Product Owner</Th>
                <Th>Schedule</Th>
                <Th>Status</Th>
                <Th>Actions</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {projects.map((project) => (
                <ProjectRow
                  key={project.id}
                  project={project}
                  onToggle={() => handleToggle(project.id)}
                  onEdit={() => navigate(`/admin/projects/${project.id}/edit`)}
                  onDelete={() => setConfirmDelete(project.id)}
                  onClick={() => navigate(`/admin/projects/${project.id}/log`)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {confirmDelete && (
        <ConfirmDialog
          message="Delete this project? All its configuration will be permanently removed."
          onConfirm={() => handleDelete(confirmDelete)}
          onCancel={() => setConfirmDelete(null)}
        />
      )}

    </div>
  );
}

function ProjectRow({ project, onToggle, onEdit, onDelete, onClick }) {
  const isActive = project.status !== 'paused';
  const previewUrl = project.scanMode === 'site'
    ? (project.urlsText?.split('\n').find(Boolean) ?? '—')
    : (project.url || '—');

  return (
    <tr
      className="hover:bg-slate-50 transition-colors align-top cursor-pointer"
      onClick={onClick}
    >
      <td className="px-5 py-4">
        <p className="font-semibold text-slate-900">{project.name || '—'}</p>
        <p className="text-xs text-slate-400 font-mono mt-0.5 max-w-xs truncate">{previewUrl}</p>
        <span className="inline-block mt-1 text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 uppercase tracking-wide">
          {project.scanMode === 'site' ? 'Whole site' : 'Single page'}
        </span>
      </td>
      <td className="px-5 py-4">
        <p className="text-slate-900">{project.productOwner?.name || '—'}</p>
        <p className="text-xs text-slate-400 mt-0.5">{project.productOwner?.email || ''}</p>
      </td>
      <td className="px-5 py-4 text-xs text-slate-600">
        {formatSchedule(project)}
      </td>
      <td className="px-5 py-4" onClick={(e) => e.stopPropagation()}>
        <button
          onClick={onToggle}
          className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border transition-colors ${
            isActive
              ? 'bg-green-50 text-green-700 border-green-200 hover:bg-green-100'
              : 'bg-slate-100 text-slate-500 border-slate-200 hover:bg-slate-200'
          }`}
          aria-label={`${isActive ? 'Pause' : 'Activate'} ${project.name}`}
        >
          <span className={`w-1.5 h-1.5 rounded-full ${isActive ? 'bg-green-500' : 'bg-slate-400'}`} />
          {isActive ? 'Active' : 'Paused'}
        </button>
      </td>
      <td className="px-5 py-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2">
          <button
            onClick={onEdit}
            className="text-xs font-medium text-brand-500 hover:text-brand-600 px-2.5 py-1 border border-brand-500 hover:border-brand-600 rounded-md transition-colors whitespace-nowrap"
          >
            Edit
          </button>
          <button
            onClick={onDelete}
            className="text-xs font-medium text-slate-400 hover:text-red-600 px-2.5 py-1 border border-slate-200 hover:border-red-300 rounded-md transition-colors"
          >
            Delete
          </button>
        </div>
      </td>
    </tr>
  );
}

const DAYS_SHORT  = { mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun' };
const DAY_LABELS  = { mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday', sun: 'Sunday' };

function fmt12h(time24) {
  if (!time24) return '';
  const [hStr = '09', mStr = '00'] = time24.split(':');
  const h24  = parseInt(hStr, 10);
  const ampm = h24 >= 12 ? 'PM' : 'AM';
  const h12  = h24 === 0 ? 12 : h24 > 12 ? h24 - 12 : h24;
  return `${h12}:${mStr} ${ampm}`;
}

function formatSchedule(p) {
  const { frequency, daysOfWeek, dayOfWeek, monthlyType, monthlyDay, dayOfMonth, monthlyNth, monthlyWeekday, time } = p;
  if (!frequency || !time) return '—';
  const t = fmt12h(time);
  if (frequency === 'today')   return `Once today at ${t}`;
  if (frequency === 'daily')   return `Every day at ${t}`;
  if (frequency === 'weekly') {
    const days = (daysOfWeek ?? (dayOfWeek ? [dayOfWeek] : [])).map((d) => DAYS_SHORT[d]).filter(Boolean).join(', ');
    return `Every ${days || '—'} at ${t}`;
  }
  if (frequency === 'monthly') {
    if (monthlyType === 'nth-weekday') {
      return `Monthly on the ${monthlyNth ?? 'first'} ${DAY_LABELS[monthlyWeekday] ?? monthlyWeekday} at ${t}`;
    }
    return `Monthly on day ${monthlyDay ?? dayOfMonth ?? '?'} at ${t}`;
  }
  return '—';
}

function Th({ children }) {
  return (
    <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider whitespace-nowrap">
      {children}
    </th>
  );
}

function ConfirmDialog({ message, onConfirm, onCancel }) {
  return (
    <>
      <div className="fixed inset-0 bg-black/30 z-40" onClick={onCancel} aria-hidden="true" />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-xl shadow-xl p-6 max-w-sm w-full border border-slate-200">
          <p className="text-sm font-semibold text-slate-900 mb-1">Are you sure?</p>
          <p className="text-sm text-slate-600 mb-5">{message}</p>
          <div className="flex justify-end gap-2">
            <button onClick={onCancel} className="btn-secondary text-sm">Cancel</button>
            <button
              onClick={onConfirm}
              className="inline-flex items-center justify-center px-4 py-2 rounded-md bg-red-600 text-white text-sm font-medium hover:bg-red-700 transition-colors"
            >
              Delete
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
