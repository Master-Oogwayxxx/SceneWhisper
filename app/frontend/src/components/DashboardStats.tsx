import { StatCard } from './StatCard'
import { AlertCircle, CheckCircle2, Clock, Delete, ListTodo, Loader2, PauseCircle } from 'lucide-react'
import { Stats } from '@/types/types';

interface DashboardStatsProps {
    stats: Stats;
    openTaskQueueWithFilter: (status: string) => void;
}

const DashboardStats = ({ stats, openTaskQueueWithFilter }: DashboardStatsProps) => {

    return (
        <div className="-mx-2 grid auto-cols-[4.875rem] grid-flow-col gap-1.5 overflow-x-auto px-2 pb-1 sm:auto-cols-[minmax(9rem,1fr)] sm:gap-3 md:mx-0 md:grid-flow-row md:grid-cols-3 md:overflow-visible md:px-0 md:pb-0 lg:grid-cols-7">
            <StatCard
                label="Total Tasks"
                value={stats.total}
                icon={ListTodo}
                variant="default"
                onClick={() => openTaskQueueWithFilter('all')}
            />
            <StatCard
                label="Queued"
                value={stats.queued}
                icon={Clock}
                variant="warning"
                onClick={() => openTaskQueueWithFilter('queued')}
            />
            <StatCard
                label="Processing"
                value={stats.processing}
                icon={Loader2}
                variant="primary"
                onClick={() => openTaskQueueWithFilter('processing')}
            />
            <StatCard
                label="Completed"
                value={stats.completed}
                icon={CheckCircle2}
                variant="success"
                onClick={() => openTaskQueueWithFilter('completed')}
            />
            <StatCard
                label="Failed"
                value={stats.failed}
                icon={AlertCircle}
                variant="destructive"
                onClick={() => openTaskQueueWithFilter('failed')}
            />
            <StatCard
                label="Cancelled"
                value={stats.cancelled}
                icon={Delete}
                variant="destructive"
                onClick={() => openTaskQueueWithFilter('cancelled')}
            />
            <StatCard
                label="Paused"
                value={stats.paused}
                icon={PauseCircle}
                variant="warning"
                onClick={() => openTaskQueueWithFilter('paused')}
            />
        </div>
    )
}

export default DashboardStats
