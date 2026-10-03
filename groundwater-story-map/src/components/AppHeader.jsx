import brandIcon from "../../icons8-favicon-100.png";

export default function AppHeader({ activeView, onChangeView }) {
  return (
    <header className="app-header">
      <button className="brand" onClick={() => onChangeView("story")} aria-label="Open Kenya Groundwater Lens story">
        <img className="brand-mark" src={brandIcon} alt="" aria-hidden="true" />
        <span>Kenya Groundwater Lens</span>
      </button>

      <nav className="primary-nav" aria-label="Main sections">
        <button className={activeView === "story" ? "is-active" : ""} onClick={() => onChangeView("story")}>
          <span>Part A</span> Water story
        </button>
        <button className={activeView === "dashboard" ? "is-active" : ""} onClick={() => onChangeView("dashboard")}>
          <span>Part B</span> Dashboard
        </button>
      </nav>

      <div className="app-status"><span className="status-dot" /> Analysis current</div>
    </header>
  );
}
