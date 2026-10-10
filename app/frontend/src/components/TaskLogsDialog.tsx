import { useEffect, useState } from 'react';
import { ScrollText, Loader2, AlertCircle } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { logApi } from '@/api/logs';
import type { LogEntry } from '@/types/types';

interface TaskLogsDialogProps {
  taskId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const levelVariant: Record<LogEntry['level'], string> = {
  DEBUG: 'text-muted-foreground',
  INFO: 'text-foreground',
  WARNING: 'text-yellow-500',
  ERROR: 'text-destructive',
  CRITICAL: 'text-destructive font-bold',
};

const levelBadgeVariant: Record<LogEntry['level'], 'secondary' | 'destructive' | 'outline' | 'default'> = {
  DEBUG: 'outline',
  INFO: 'secondary',
  WARNING: 'secondary',
  ERROR: 'destructive',
  CRITICAL: 'destructive',
};

function formatLogTime(isoString: string): string {
  const d = new Date(/[Z+]/.test(isoString.slice(10)) ? isoString : isoString + 'Z');
  const pad = (n: number) => String(n).padStart(2, '0');
  let hours = d.getHours();
  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12 || 12;
  return `${pad(hours)}:${pad(d.getMinutes())}:${pad(d.getSeconds())} ${ampm}`;
}

export function TaskLogsDialog({ taskId, open, onOpenChange }: TaskLogsDialogProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);

  useEffect(() => {
    if (!open) return;

    let ignore = false;
    setLoading(true);
    setError(null);
    setLogs([]);

    logApi
      .getLogs({ task_id: taskId, limit: 500 })
      .then((res) => {
        if (ignore) return;
        setLogs(res.items);
      })
      .catch(() => {
        if (ignore) return;
        setError('Failed to load logs. Please try again.');
      })
      .finally(() => {
        if (!ignore) setLoading(false);
      });

    return () => { ignore = true; };
  }, [open, taskId]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-card border-border max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ScrollText className="w-5 h-5 text-primary" />
            Task Logs
          </DialogTitle>
          <DialogDescription className="font-mono text-xs">{taskId}</DialogDescription>
        </DialogHeader>

        {loading && (
          <div className="flex items-center justify-center py-10 gap-2 text-muted-foreground">
            <Loader2 className="w-5 h-5 animate-spin" />
            <span className="text-sm">Loading logs…</span>
          </div>
        )}

        {!loading && error && (
          <div className="flex items-center gap-2 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-3 text-sm text-destructive">
            <AlertCircle className="w-4 h-4 shrink-0" />
            {error}
          </div>
        )}

        {!loading && !error && logs.length === 0 && (
          <p className="text-sm text-muted-foreground py-6 text-center">
            No logs found for this task.
          </p>
        )}

        {!loading && !error && logs.length > 0 && (
          <ScrollArea className="max-h-[65vh] pr-3">
            <div className="space-y-1 py-1 font-mono text-xs">
              {logs.map((log) => (
                <div key={log.id} className="rounded-md border border-border bg-muted/20 px-3 py-2 space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-muted-foreground shrink-0">{formatLogTime(log.created_at)}</span>
                    <Badge
                      variant={levelBadgeVariant[log.level]}
                      className={`text-[10px] px-1.5 py-0 shrink-0 ${log.level === 'WARNING' ? 'text-yellow-500 border-yellow-500/50' : ''}`}
                    >
                      {log.level}
                    </Badge>
                    <span className="text-muted-foreground/60 shrink-0">{log.module}</span>
                    <span className={`flex-1 min-w-0 break-words ${levelVariant[log.level]}`}>
                      {log.message}
                    </span>
                  </div>
                  {log.exc_text && (
                    <details className="mt-1">
                      <summary className="cursor-pointer text-muted-foreground hover:text-foreground select-none">
                        Exception
                      </summary>
                      <pre className="mt-1 text-[10px] text-destructive whitespace-pre-wrap break-words bg-destructive/5 rounded p-2">
                        {log.exc_text}
                      </pre>
                    </details>
                  )}
                </div>
              ))}
            </div>
          </ScrollArea>
        )}
      </DialogContent>
    </Dialog>
  );
}
