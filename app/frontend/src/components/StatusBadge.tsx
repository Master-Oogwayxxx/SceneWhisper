import React from 'react';
import { Clock, CheckCircle, XCircle, Loader, X, Pause } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { TaskStatus } from '@/types/types';

interface StatusBadgeProps {
    status: TaskStatus;
}

export const StatusBadge: React.FC<StatusBadgeProps> = ({ status }) => {
    const configs: Record<TaskStatus, { bg: string; text: string; icon: LucideIcon }> = {
        queued: { bg: 'bg-yellow-100', text: 'text-yellow-800', icon: Clock },
        processing: { bg: 'bg-blue-100', text: 'text-blue-800', icon: Loader },
        completed: { bg: 'bg-green-100', text: 'text-green-800', icon: CheckCircle },
        failed: { bg: 'bg-red-100', text: 'text-red-800', icon: XCircle },
        cancelled: { bg: 'bg-gray-100', text: 'text-gray-800', icon: X },
        paused: { bg: 'bg-yellow-50', text: 'text-yellow-700', icon: Pause }
    };

    const config = configs[status];
    const Icon = config.icon;

    return (
        <span className={`inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-medium ${config.bg} ${config.text}`}>
            <Icon size={14} />
            {status.charAt(0).toUpperCase() + status.slice(1)}
        </span>
    );
};