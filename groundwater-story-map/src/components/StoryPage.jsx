import GroundwaterAnimation from "./GroundwaterAnimation.jsx";
import MapAnalysisStory from "./MapAnalysisStory.jsx";

const findings = [
  {
    number: "21,284",
    title: "A useful national starting point",
    text: "The inventory brings together wells, boreholes and springs recorded across 40 counties. It gives water managers many places to start checking."
  },
  {
    number: "72.8%",
    title: "The illusion of abundance",
    text: "Nearly three quarters of all records are in Kakamega and Vihiga. This shows strong data collection in those counties, not Kenya’s true share of groundwater."
  },
  {
    number: "2.6%",
    title: "The depth data black box",
    text: "Only 552 records can support depth comparisons. Their median construction depth is 75 metres, but construction depth is not the water-table depth."
  }
];

export default function StoryPage({ onOpenDashboard }) {
  return (
    <div className="story-page">
      <section className="animation-stage" aria-label="Animated groundwater overview">
        <GroundwaterAnimation />
      </section>

      <section className="story-body" id="water-story">
        <div className="story-intro">
          <p className="section-label">THE LEAD · THE MIRAGE OF THE MAP</p>
          <h2>Mapping Kenya’s groundwater: what 21,284 records reveal—and hide</h2>
          <p>Kenya has a valuable public list of recorded wells, boreholes and springs. It helps us see where information exists and where follow-up work can begin. But there is a catch: this is a map of survey records, not a full count of every groundwater source in the country.</p>
          <p>The dashboard is therefore a national screening tool. It gives us clues, shows strong and weak parts of the inventory, and helps plan field checks. It should not be treated as the final answer.</p>
        </div>

        <div className="finding-grid">
          {findings.map(item => (
            <article className="finding-card" key={item.title}>
              <strong>{item.number}</strong>
              <h3>{item.title}</h3>
              <p>{item.text}</p>
            </article>
          ))}
        </div>

        <section className="story-split story-caveat">
          <div>
            <p className="section-label">WHY IT MATTERS · A TOOL, NOT A CENSUS</p>
            <h2>The map can show where records are strong. It cannot show where all groundwater exists.</h2>
            <p>A bright place on the map may have been surveyed more often. A quiet place may simply have fewer records. A missing depth is an information gap, not proof that a source is shallow, inactive or outside the law.</p>
            <p>This is why the dashboard separates what the data says from what still needs to be checked.</p>
          </div>
          <ul className="reading-rules">
            <li><b>Bright cluster</b><span>More records in this inventory—not automatically more groundwater.</span></li>
            <li><b>Blank or quiet area</b><span>Less nearby information—not proof that groundwater is absent.</span></li>
            <li><b>Depth line or column</b><span>Recorded construction depth—not the water table or available water.</span></li>
            <li><b>Map point</b><span>A lead to check—not proof of a permit, owner, offence or bill.</span></li>
          </ul>
        </section>

        <MapAnalysisStory onOpenDashboard={onOpenDashboard} />

        <section className="story-split">
          <div>
            <p className="section-label">THE SOLUTION · THE WRA OPPORTUNITY</p>
            <h2>The map shows where to look. Verification turns a point into useful evidence.</h2>
            <p>The gaps do not make the map useless. They show where WRA, counties, researchers and private operators can work together. Each point can begin a simple process that links the public inventory to official records and real conditions on the ground.</p>
            <button className="story-cta" onClick={onOpenDashboard}>Explore the dashboard →</button>
          </div>
          <ol className="verification-list">
            <li><span>01</span><div><b>Identify the source</b><p>Use the public point to locate a possible well, borehole or spring.</p></div></li>
            <li><span>02</span><div><b>Match official records</b><p>Compare the point with WRA permits, applications and completion records.</p></div></li>
            <li><span>03</span><div><b>Visit the site</b><p>Confirm its location, condition, operator, use and the people who depend on it.</p></div></li>
            <li><span>04</span><div><b>Measure water use</b><p>Link chargeable abstraction to a reliable meter and verified readings.</p></div></li>
            <li><span>05</span><div><b>Manage fairly</b><p>Use checked evidence for planning, permits, lawful charges and a clear correction process.</p></div></li>
          </ol>
        </section>

        <section className="story-conclusion">
          <p className="section-label">THE TAKEAWAY</p>
          <h2>Digital maps give us the clues. Fair water management is won on the ground.</h2>
          <p>Good decisions need both parts: a dashboard that helps people see patterns, and fieldwork that confirms what each record means. The inventory is the starting line. Better records, site visits and measured use are what turn it into responsible groundwater management.</p>
        </section>

        <footer className="story-source">
          <b>Data acknowledgement</b>
          <p>Groundwater-source records: mWater dataset published through UNESCO IHP-WINS, February 2025 snapshot. Map background: OpenFreeMap, OpenMapTiles and OpenStreetMap contributors.</p>
        </footer>
      </section>
    </div>
  );
}
