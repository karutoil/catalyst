import { useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { tasksApi } from '../../services/api/tasks';
import { notifyError, notifySuccess } from '../../utils/notify';
import type { Task } from '../../types/task';

export const actionOptions: Array<{ value: Task['action']; label: string }> = [
  { value: 'restart', label: 'Restart server' },
  { value: 'start', label: 'Start server' },
  { value: 'stop', label: 'Stop server' },
  { value: 'backup', label: 'Create backup' },
  { value: 'command', label: 'Send command' },
];

function CreateTaskModal({ serverId, disabled = false }: { serverId: string; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [action, setAction] = useState<Task['action']>('restart');
  const [schedule, setSchedule] = useState('0 3 * * *');
  const [command, setCommand] = useState('');
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: () =>
      tasksApi.create(serverId, {
        name: name.trim(),
        description: description.trim() || undefined,
        action,
        schedule: schedule.trim(),
        payload: action === 'command' && command.trim() ? { command: command.trim() } : undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tasks', serverId] });
      notifySuccess('Task created');
      setOpen(false);
      setName('');
      setDescription('');
      setAction('restart');
      setSchedule('0 3 * * *');
      setCommand('');
    },
    onError: (error: any) => {
      const message = error?.response?.data?.error || 'Failed to create task';
      notifyError(message);
    },
  });

  const disableSubmit = useMemo(() => {
    if (!name.trim() || !schedule.trim()) return true;
    if (action === 'command' && !command.trim()) return true;
    return mutation.isPending || disabled;
  }, [action, command, name, schedule, mutation.isPending, disabled]);

  return (
    <div>
      <button
        type="button"
        className="rounded-md bg-primary-600 px-3 py-1 text-xs font-semibold text-white shadow-lg shadow-primary-500/20 transition-all duration-300 hover:bg-primary-500 disabled:opacity-60"
        onClick={() => {
          if (!disabled) setOpen(true);
        }}
        disabled={disabled}
      >
        Create task
      </button>
      {open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-white dark:bg-slate-950/60 px-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-surface-light dark:shadow-surface-dark transition-all duration-300 dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Create task</h2>
              <button
                className="rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-500 transition-all duration-300 hover:border-primary-500 dark:border-slate-800 dark:text-slate-300 dark:hover:border-primary-500/30"
                onClick={() => setOpen(false)}
              >
                Close
              </button>
            </div>
            <div className="mt-4 space-y-3 text-sm text-slate-600 dark:text-slate-300">
              <label className="block space-y-1">
                <span className="text-slate-500 dark:text-slate-400">Name</span>
                <input
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 transition-all duration-300 focus:border-primary-500 focus:outline-none hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:focus:border-primary-400 dark:hover:border-primary-500/30"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Nightly restart"
                />
              </label>
              <label className="block space-y-1">
                <span className="text-slate-500 dark:text-slate-400">Description (optional)</span>
                <input
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 transition-all duration-300 focus:border-primary-500 focus:outline-none hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:focus:border-primary-400 dark:hover:border-primary-500/30"
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  placeholder="Restart to apply updates"
                />
              </label>
              <label className="block space-y-1">
                <span className="text-slate-500 dark:text-slate-400">Action</span>
                <select
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 transition-all duration-300 focus:border-primary-500 focus:outline-none hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:focus:border-primary-400 dark:hover:border-primary-500/30"
                  value={action}
                  onChange={(event) => setAction(event.target.value as Task['action'])}
                >
                  {actionOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              {action === 'command' ? (
                <label className="block space-y-1">
                  <span className="text-slate-500 dark:text-slate-400">Command</span>
                  <input
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 transition-all duration-300 focus:border-primary-500 focus:outline-none hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:focus:border-primary-400 dark:hover:border-primary-500/30"
                    value={command}
                    onChange={(event) => setCommand(event.target.value)}
                    placeholder="say Server restart in 5 minutes"
                  />
                </label>
              ) : null}
              <label className="block space-y-1">
                <span className="text-slate-500 dark:text-slate-400">Schedule (cron)</span>
                <input
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 transition-all duration-300 focus:border-primary-500 focus:outline-none hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:focus:border-primary-400 dark:hover:border-primary-500/30"
                  value={schedule}
                  onChange={(event) => setSchedule(event.target.value)}
                  placeholder="0 3 * * *"
                />
                <span className="text-xs text-slate-500 dark:text-slate-400 dark:text-slate-500">
                  Example: 0 3 * * * runs daily at 3 AM.
                </span>
              </label>
            </div>
            <div className="mt-5 flex justify-end gap-2 text-xs">
              <button
                className="rounded-md border border-slate-200 px-3 py-1 font-semibold text-slate-600 transition-all duration-300 hover:border-primary-500 hover:text-slate-900 dark:border-slate-800 dark:text-slate-300 dark:hover:border-primary-500/30"
                onClick={() => setOpen(false)}
              >
                Cancel
              </button>
              <button
                className="rounded-md bg-primary-600 px-4 py-2 font-semibold text-white shadow-lg shadow-primary-500/20 transition-all duration-300 hover:bg-primary-500 disabled:opacity-60"
                onClick={() => mutation.mutate()}
                disabled={disableSubmit}
              >
                {mutation.isPending ? 'Creating...' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default CreateTaskModal;
