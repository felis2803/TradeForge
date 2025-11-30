import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { useWs } from '../App.tsx';

interface BotsResponse {
  bots: Array<{
    botName: string;
    initialBalanceInt: string;
    currentBalanceInt: string;
    connected?: boolean;
  }>;
}

interface BotsProps {
  apiBase: string;
}

function formatBalance(value: string): string {
  const trimmed = value?.toString().trim() ?? '';
  if (!trimmed) {
    return '0';
  }
  const negative = trimmed.startsWith('-');
  const digits = negative ? trimmed.slice(1) : trimmed;
  if (!/^\d+$/.test(digits)) {
    return trimmed;
  }
  const formatted = digits.replace(/\B(?=(\d{3})+(?!\d))/g, '\u202f');
  return negative ? `-${formatted}` : formatted;
}

export default function Bots({ apiBase }: BotsProps): JSX.Element {
  const ws = useWs();
  const queryClient = useQueryClient();
  const { data } = useQuery<BotsResponse>({
    queryKey: ['bots'],
    queryFn: async () => {
      const response = await fetch(`${apiBase}/v1/bots`);
      if (!response.ok) {
        throw new Error('Не удалось загрузить список ботов');
      }
      return response.json();
    },
    refetchInterval: 5000,
  });

  useEffect(() => {
    const unsubscribe = ws.on('balance.update', (message) => {
      queryClient.setQueryData<BotsResponse | undefined>(['bots'], (prev) => {
        const current = prev ?? { bots: [] };
        const nextBots = current.bots.slice();
        const index = nextBots.findIndex(
          (bot) => bot.botName === message.payload.botName,
        );
        const balanceInt = `${message.payload.balanceInt ?? ''}`;
        if (index >= 0) {
          nextBots[index] = {
            ...nextBots[index],
            currentBalanceInt: balanceInt,
          };
        } else {
          nextBots.push({
            botName: message.payload.botName,
            initialBalanceInt: balanceInt,
            currentBalanceInt: balanceInt,
          });
        }
        return { bots: nextBots };
      });
      void queryClient.invalidateQueries({ queryKey: ['bots'] });
    });

    return () => {
      unsubscribe();
    };
  }, [queryClient, ws]);

  const bots = data?.bots ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between text-sm">
        <span className="text-textMuted">Активные боты:</span>
        <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-semibold text-primary">
          {bots.length}
        </span>
      </div>
      <div className="overflow-hidden rounded-xl border border-white/5 bg-surface/30">
        <table className="min-w-full divide-y divide-white/5 text-left text-sm">
          <thead className="bg-white/5">
            <tr>
              <th className="px-4 py-3 font-medium text-textMuted">Имя бота</th>
              <th className="px-4 py-3 font-medium text-textMuted">Начальный баланс</th>
              <th className="px-4 py-3 font-medium text-textMuted">Текущий баланс</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {bots.map((bot) => (
              <tr key={bot.botName} className="hover:bg-white/5 transition-colors">
                <td className="px-4 py-3 font-medium text-text">
                  <div className="flex items-center gap-2">
                    <div className="h-2 w-2 rounded-full bg-success shadow-[0_0_8px_#00FF94]" />
                    {bot.botName}
                  </div>
                </td>
                <td className="px-4 py-3 text-textMuted font-mono">
                  {formatBalance(bot.initialBalanceInt)}
                </td>
                <td className="px-4 py-3 font-mono font-medium text-text">
                  {formatBalance(bot.currentBalanceInt)}
                </td>
              </tr>
            ))}
            {bots.length === 0 && (
              <tr>
                <td
                  colSpan={3}
                  className="px-4 py-8 text-center text-textMuted"
                >
                  <div className="flex flex-col items-center gap-2">
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-8 h-8 opacity-50">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 17.25v1.007a3 3 0 01-.879 2.122L7.5 21h9l-.621-.621A3 3 0 0115 18.257V17.25m6-12V15a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 15V5.25m18 0A2.25 2.25 0 0018.75 3H5.25A2.25 2.25 0 003 5.25m18 0V12a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 12V5.25" />
                    </svg>
                    <span>Нет подключенных ботов</span>
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
