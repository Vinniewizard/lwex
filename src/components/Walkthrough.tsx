import React from 'react';
import { Joyride, STATUS } from 'react-joyride';

interface WalkthroughProps {
  run: boolean;
  onFinish: () => void;
  isDark: boolean;
}

const steps = [
  {
    target: 'body',
    content: 'Welcome to Maritech! Let us take a quick tour of the trading platform.',
    placement: 'center' as const,
    disableBeacon: true,
  },
  {
    target: '.tour-asset-selector',
    content: 'Here you can pick which asset you want to trade (e.g. Synthetic indices, Cryptocurrencies, etc).',
    placement: 'bottom' as const,
  },
  {
    target: '.tour-chart',
    content: 'This is the main chart area where you can observe real-time spot price movements.',
    placement: 'bottom' as const,
  },
  {
    target: '.tour-trade-controls',
    content: 'Here you configure your trade. Pick your contract duration, enter your stake, and choose your trade direction (Rise or Fall).',
    placement: 'left' as const,
  },
  {
    target: '.tour-positions',
    content: 'Once you buy a contract, it appears under Open Positions. Follow its active profit/loss here.',
    placement: 'right' as const,
  },
  {
    target: '.tour-account',
    content: 'Manage your real/demo funds, deposit, and adjust settings from the sidebar. You are ready!',
    placement: 'bottom' as const,
  }
];

export default function Walkthrough({ run, onFinish, isDark }: WalkthroughProps) {

  const handleJoyrideCallback = (data: any) => {
    const { status } = data;
    const finishedStatuses: string[] = [STATUS.FINISHED, STATUS.SKIPPED];
    
    if (finishedStatuses.includes(status)) {
      onFinish();
    }
  };

  return (
    <Joyride
      {...{
        steps,
        run,
        continuous: true,
        scrollToFirstStep: true,
        showSkipButton: true,
        callback: handleJoyrideCallback,
        styles: {
          options: {
            zIndex: 10000,
            primaryColor: '#10b981', // emerald-500
            backgroundColor: isDark ? '#0f172a' : '#ffffff', // slate-900 / white
            textColor: isDark ? '#f8fafc' : '#000000',
          },
          tooltipContainer: {
            textAlign: 'left',
          },
          buttonNext: {
            backgroundColor: '#10b981',
            fontSize: '12px',
          },
          buttonBack: {
            marginRight: 10,
            color: isDark ? '#94a3b8' : '#64748b',
            fontSize: '12px',
          },
          buttonSkip: {
            color: isDark ? '#94a3b8' : '#64748b',
            fontSize: '12px',
          }
        }
      } as any}
    />
  );
}
