import type { Preview } from "@storybook/react";
import "../design-system/tokens/index.css";
import "../design-system/foundation/base.css";
import React, { useEffect } from "react";
import { ThemeProvider, useTheme } from "../design-system/theme";
import { ToastProvider } from "../design-system/components/Toast";

function ThemeWrapper({ children, theme }: { children: React.ReactNode; theme: "light" | "dark" }) {
  const { setTheme } = useTheme();

  useEffect(() => {
    setTheme(theme);
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme, setTheme]);

  return <>{children}</>;
}

const preview: Preview = {
  parameters: {
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
    viewport: {
      viewports: {
        mobile: {
          name: "Mobile (iPhone 14)",
          styles: { width: "390px", height: "844px" },
          type: "mobile",
        },
        tablet: {
          name: "Tablet (iPad Mini)",
          styles: { width: "768px", height: "1024px" },
          type: "tablet",
        },
        desktop: {
          name: "Desktop (Standard)",
          styles: { width: "1280px", height: "800px" },
          type: "desktop",
        },
      },
    },
    backgrounds: {
      disable: true,
    },
  },
  globalTypes: {
    theme: {
      name: "Theme",
      description: "Global theme for components",
      defaultValue: "light",
      toolbar: {
        icon: "circlehollow",
        items: [
          { value: "light", title: "Light Theme", icon: "sun" },
          { value: "dark", title: "Dark Theme", icon: "moon" },
        ],
        showName: true,
      },
    },
  },
  decorators: [
    (Story, context) => {
      const theme = context.globals.theme || "light";

      return (
        <ThemeProvider defaultTheme={theme}>
          <ToastProvider>
            <ThemeWrapper theme={theme}>
              <div
                style={{
                  minHeight: "100vh",
                  backgroundColor: "var(--cc-bg-canvas)",
                  color: "var(--cc-text-primary)",
                  padding: "24px",
                  boxSizing: "border-box",
                }}
              >
                <Story />
              </div>
            </ThemeWrapper>
          </ToastProvider>
        </ThemeProvider>
      );
    },
  ],
};

export default preview;
