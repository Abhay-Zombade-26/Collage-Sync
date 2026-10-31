import React from 'react';
import { RouterProvider } from '@tanstack/react-router';
import { router } from './router';

import { ThemeProvider } from './context/ThemeContext';

export const App: React.FC = () => {
  return (
    <ThemeProvider>
      <RouterProvider router={router} />
    </ThemeProvider>
  );
};
