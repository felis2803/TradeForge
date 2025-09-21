import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { useWs } from '../App.tsx';

interface BotsResponse {
  bots: Array<{
    botName: string;
    initialBalanceInt: number;
    currentBalanceInt: number;
    connected?: boolean;
  }>;
}

interface BotsProps {
  apiBase: string;
}

const formatter = new Intl.NumberFormat('ru-RU');

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
        const index = nextBots.findIndex((bot) => bot.botName === message.payload.botName);
        if (index >= 0) {
          nextBots[index] = {
            ...nextBots[index],
            currentBalanceInt: Number(message.payload.balanceInt),
          };
        } else {
          nextBots.push({
            botName: message.payload.botName,
            initialBalanceInt: Number(message.payload.balanceInt),
            currentBalanceInt: Number(message.payload.balanceInt),
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
      <div className="text-sm text-slate-300">Активные боты: {bots.length}</div>
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-slate-800 text-left text-sm">
          <thead className="bg-slate-900/60">
            <tr>
              <th className="px-3 py-2 font-medium">Имя бота</th>
              <th className="px-3 py-2 font-medium">Начальный баланс</th>
              <th className="px-3 py-2 font-medium">Текущий баланс</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {bots.map((bot) => (
              <tr key={bot.botName} className="hover:bg-slate-900/40">
                <td className="px-3 py-2 font-medium text-slate-200">{bot.botName}</td>
                <td className="px-3 py-2 text-slate-300">{formatter.format(bot.initialBalanceInt)}</td>
                <td className="px-3 py-2 text-slate-200">{formatter.format(bot.currentBalanceInt)}</td>
              </tr>
            ))}
            {bots.length === 0 && (
              <tr>
                <td colSpan={3} className="px-3 py-6 text-center text-slate-500">
                  Нет подключенных ботов
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
