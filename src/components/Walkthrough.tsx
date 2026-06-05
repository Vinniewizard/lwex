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
    content: 'Welcome to the LWEX Terminal. The fastest institutional-grade trading platform. Let\'s begin your edge.',
    placement: 'center' as const,
    disableBeacon: true,
  },
  {
    target: '.tour-asset-selector',
    content: 'Select your core trading instrument here. We offer high-frequency synthetic indices and premium cryptocurrencies.',
    placement: 'bottom' as const,
  },
  {
    target: '.tour-chart',
    content: 'The primary terminal chart. Observe real-time spot price movements with zero latency.',
    placement: 'bottom' as const,
  },
  {
    target: '.tour-trade-controls',
    content: 'Execute with precision. Configure your contract duration, size, and definitive market direction.',
    placement: 'left' as const,
  },
  {
    target: '.tour-positions',
    content: 'Your live portfolio. Track active profit/loss in real time as your contracts run.',
    placement: 'right' as const,
  },
  {
    target: '.tour-account',
    content: 'Manage liquidity, transition between demo testing and live capital, and optimize settings here. Enter the Arena.',
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
