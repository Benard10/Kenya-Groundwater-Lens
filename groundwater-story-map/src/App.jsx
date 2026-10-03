import { useState } from "react";
import AppHeader from "./components/AppHeader.jsx";
import StoryPage from "./components/StoryPage.jsx";
import GroundwaterDashboard from "./components/GroundwaterDashboard.jsx";

export default function App() {
  const [activeView, setActiveView] = useState(() => window.location.hash.startsWith("#dashboard") ? "dashboard" : "story");

  const changeView = (view, dashboardMode = "density") => {
    setActiveView(view);
    const dashboardHash = dashboardMode === "density" ? "#dashboard" : `#dashboard/${dashboardMode}`;
    window.history.replaceState(null, "", view === "dashboard" ? dashboardHash : "#story");
  };

  return (
    <div className="app-shell">
      <AppHeader activeView={activeView} onChangeView={changeView} />
      <div className="app-content">
        {activeView === "story"
          ? <StoryPage onOpenDashboard={mode => changeView("dashboard", mode)} />
          : <GroundwaterDashboard />}
      </div>
    </div>
  );
}
