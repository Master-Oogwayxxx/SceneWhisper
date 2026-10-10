import React, { useState, useEffect } from 'react';
import { PlayCircle, Loader } from 'lucide-react';
import { TaskCard } from '../components/TaskCard';
import type { Task, Page } from '@/types/types';
import { taskApi } from '@/api/tasks';

interface TasksListProps {
    onNavigate: (page: Page) => void;
}

export const TasksList: React.FC<TasksListProps> = ({ onNavigate }) => {
    const [tasks, setTasks] = useState<Task[]>([]);
    const [loading, setLoading] = useState<boolean>(true);

    useEffect(() => {
        fetchTasks();
        const interval = setInterval(fetchTasks, 10000);
        return () => clearInterval(interval);
    }, []);

    const fetchTasks = async (): Promise<void> => {
        try {
            const data = await taskApi.getTasks();
            setTasks(data.tasks);
        } catch (err) {
            console.error('Failed to fetch tasks:', err);
        } finally {
            setLoading(false);
        }
    };

    const handleCancel = async (taskId: string): Promise<void> => {
        try {
            await taskApi.cancelTask(taskId);
            fetchTasks();
        } catch (err) {
            console.error('Failed to cancel task:', err);
        }
    };

    const handleDelete = async (taskId: string): Promise<void> => {
        try {
            await taskApi.deleteTask(taskId);
            fetchTasks();
        } catch (err) {
            console.error('Failed to delete task:', err);
        }
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center h-64">
                <Loader className="animate-spin text-blue-600" size={48} />
            </div>
        );
    }

    return (
        <div className="px-4">
            <div className="flex justify-between items-center mb-8">
                <h1 className="text-3xl font-bold text-gray-800">Processing Queue</h1>
                <button
                    onClick={() => onNavigate('scan')}
                    className="bg-blue-600 text-white px-6 py-2 rounded-lg hover:bg-blue-700 transition"
                >
                    Add Videos
                </button>
            </div>

            {tasks.length === 0 ? (
                <div className="bg-white rounded-lg shadow p-12 text-center">
                    <PlayCircle className="mx-auto mb-4 text-gray-400" size={64} />
                    <h2 className="text-xl font-bold text-gray-700 mb-2">No Videos in Queue</h2>
                    <p className="text-gray-600 mb-6">Start by scanning a directory with video files.</p>
                    <button
                        onClick={() => onNavigate('scan')}
                        className="bg-blue-600 text-white px-6 py-3 rounded-lg hover:bg-blue-700 transition"
                    >
                        Scan Directory
                    </button>
                </div>
            ) : (
                <div className="space-y-4">
                    {tasks.map(task => (
                        <TaskCard
                            key={task.id}
                            task={task}
                            onCancelTask={handleCancel}
                            onDeleteTask={handleDelete}
                        />
                    ))}
                </div>
            )}
        </div>
    );
};
