import { useCallback, useEffect, useMemo, useState } from 'react';
import { TasksApi, countOpenTasks, type Task, type TaskCreateInput, type TaskPatchInput, type TaskStatus } from '../lib/tasks';
import { apiErrorText } from '../lib/apiErrors';

/**
 * State of the « À traiter › Tâches » tab (docs/plan-chantiers-taches.md, lot 2): the task
 * list lives in App (the « À traiter (n) » pill of the Personnel header counts the open ones),
 * every mutation goes through /api/tasks and replaces the row in place from the server answer.
 * `enabled` = false (not an admin) → nothing is fetched (the routes answer 403 anyway).
 */
export function useTasks(enabled: boolean) {
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const reload = useCallback(async () => {
    if (!enabled) return;
    setLoading(true);
    setError('');
    try { setTasks(await TasksApi.list()); }
    catch (e) { setError(apiErrorText(e)); }
    finally { setLoading(false); }
  }, [enabled]);

  useEffect(() => { reload(); }, [reload]);

  const replace = (task: Task) => setTasks((prev) => (prev ? prev.map((x) => (x.id === task.id ? task : x)) : [task]));

  const create = useCallback(async (input: TaskCreateInput): Promise<Task> => {
    const task = await TasksApi.create(input);
    setTasks((prev) => [task, ...(prev ?? [])]);
    return task;
  }, []);
  const transition = useCallback(async (id: number, statut: TaskStatus, extra?: { motif?: string; resolution?: string }) => {
    replace(await TasksApi.transition(id, statut, extra));
  }, []);
  const patch = useCallback(async (id: number, p: TaskPatchInput) => { replace(await TasksApi.patch(id, p)); }, []);

  const openCount = useMemo(() => (tasks ? countOpenTasks(tasks) : 0), [tasks]);

  return { tasks, loading, error, reload, create, transition, patch, openCount };
}

export type TasksState = ReturnType<typeof useTasks>;
