import { useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { tasksApi } from '../../services/api/tasks';
import { notifyError, notifySuccess } from '../../utils/notify';
import type { Task } from '../../types/task';
import { actionOptions } from './CreateTaskModal';

function EditTaskModal({ serverId, task }: { serverId: string; task: Task }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(task.name);
  const [description, setDescription] = useState(task.description ?? '');
  const [action, setAction] = useState<Task['action']>(task.action);
  const [schedule, setSchedule] = useState(task.schedule);
  const [command, setCommand] = useState(
    typeof task.payload?.command === 'string' ? task.payload.command : '',
  );
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: () =>
      tasksApi.update(serverId, task.id, {
        name: name.trim(),
        description: description.trim() || undefined,
        action,
        schedule: schedule.trim(),
        payload: action === 'command' && command.trim() ? { command: command.trim() } : {},
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tasks', serverId] });
      notifySuccess('Task updated');
      setOpen(false);
    },
    onError: (error: any) => {
      const message = error?.response?.data?.error || 'Failed to update task';
      notifyError(message);
    },
  });

  const disableSubmit = useMemo(() => {
    if (!name.trim() || !schedule.trim()) return true;
    if (action === 'command' && !command.trim()) return true;
    return mutation.isPending;
  }, [action, command, name, schedule, mutation.isPending]);

  return (
    <div>
      <button
        className="rounded-md border border-slate-800 px-3 py-1 text-xs font-semibold text-slate-200 hover:border-slate-700"
        onClick={() => setOpen(true)}
      >
        Edit
      </button>
      {open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
          <div className="w-full max-w-md rounded-xl border border-slate-800 bg-slate-950 p-6 shadow-xl">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-slate-100">Edit task</h2>
              <button
                className="rounded-md border border-slate-800 px-2 py-1 text-xs text-slate-300 hover:border-slate-700"
                onClick={() => setOpen(false)}
              >
                Close
              </button>
            </div>
            <div className="mt-4 space-y-3 text-sm text-slate-100">
              <label className="block space-y-1">
                <span className="text-slate-300">Name</span>
                <input
                  className="w-full rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-slate-100 focus:border-sky-500 focus:outline-none"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                />
              </label>
              <label className="block space-y-1">
                <span className="text-slate-300">Description (optional)</span>
                <input
                  className="w-full rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-slate-100 focus:border-sky-500 focus:outline-none"
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                />
              </label>
              <label className="block space-y-1">
                <span className="text-slate-300">Action</span>
                <select
                  className="w-full rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-slate-100 focus:border-sky-500 focus:outline-none"
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
                  <span className="text-slate-300">Command</span>
                  <input
                    className="w-full rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-slate-100 focus:border-sky-500 focus:outline-none"
                    value={command}
                    onChange={(event) => setCommand(event.target.value)}
                  />
                </label>
              ) : null}
              <label className="block space-y-1">
                <span className="text-slate-300">Schedule (cron)</span>
                <input
                  className="w-full rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-slate-100 focus:border-sky-500 focus:outline-none"
                  value={schedule}
                  onChange={(event) => setSchedule(event.target.value)}
                />
              </label>
            </div>
            <div className="mt-5 flex justify-end gap-2 text-xs">
              <button
                className="rounded-md border border-slate-800 px-3 py-1 font-semibold text-slate-200 hover:border-slate-700"
                onClick={() => setOpen(false)}
              >
                Cancel
              </button>
              <button
                className="rounded-md bg-sky-600 px-4 py-2 font-semibold text-white shadow hover:bg-sky-500 disabled:opacity-60"
                onClick={() => mutation.mutate()}
                disabled={disableSubmit}
              >
                {mutation.isPending ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default EditTaskModal;
