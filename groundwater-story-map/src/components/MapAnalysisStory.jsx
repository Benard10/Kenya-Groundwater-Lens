import { useEffect, useRef, useState } from "react";

import recordDensityImage from "../../docs/images/record-density.png";
import inventoryDensityImage from "../../docs/images/inventory-density-3d.png";
import medianDepthImage from "../../docs/images/median-depth-3d.png";
import monitoringGapImage from "../../docs/images/monitoring-gaps-3d.png";
import sourceLocationsImage from "../../docs/images/source-locations.png";
import constructionDepthImage from "../../docs/images/construction-depth.png";
import depthCoverageImage from "../../docs/images/depth-coverage.png";
import updateTimelineImage from "../../docs/images/update-timeline.png";
import wellsBelowGroundImage from "../../docs/images/wells-below-ground.png";

const chapters = [
  {
    mode: "density",
    number: "01",
    label: "WHERE RECORDS GATHER",
    title: "The 2D hotspot map shows the survey footprint.",
    image: recordDensityImage,
    alt: "Dashboard showing the 2D groundwater record-density hotspot map",
    shows: "Bright areas contain many records close together. The strongest clusters are in Kakamega and Vihiga.",
    meaning: "The inventory is geographically uneven. Western Kenya is documented much more heavily, so quieter areas need more data collection before they can be compared fairly.",
    caution: "A hotspot means more records, not more groundwater, recharge or safe yield."
  },
  {
    mode: "hexDensity",
    number: "02",
    label: "COMPARE PLACES FAIRLY",
    title: "The 3D grid turns concentration into comparable cells.",
    image: inventoryDensityImage,
    alt: "Dashboard showing 3D H3 groundwater inventory density",
    shows: "Each equal-sized grid cell groups nearby records. Taller and brighter cells contain more entries.",
    meaning: "The 3D pattern confirms that a small part of western Kenya carries much of the national inventory. It helps identify where records are concentrated and where the inventory needs strengthening.",
    caution: "The column height is a display value. It is not metres of water."
  },
  {
    mode: "hexDepth",
    number: "03",
    label: "WHAT DEPTH DATA CAN SAY",
    title: "Only well-sampled cells become depth results.",
    image: medianDepthImage,
    alt: "Dashboard showing 3D median construction depth by H3 cell",
    shows: "Height and colour compare the median construction depth in cells with at least five usable measurements. Grey cells do not meet that minimum.",
    meaning: "Recorded construction depth varies from place to place, but only a small number of well-sampled cells support this comparison. These are local signals for further study, not a national depth model.",
    caution: "Construction depth is not the water-table depth, aquifer thickness or available water."
  },
  {
    mode: "monitoringGap",
    number: "04",
    label: "WHERE THE INVENTORY IS THIN",
    title: "Distance reveals places with little nearby information.",
    image: monitoringGapImage,
    alt: "Dashboard showing 3D groundwater inventory monitoring gaps",
    shows: "Taller, brighter cells are farther from the nearest mapped groundwater record.",
    meaning: "These cells point to priority areas for checking existing records and carrying out new inventory work. They reveal where our information is weakest, not where water is necessarily scarce.",
    caution: "A large gap is an information gap. It does not prove that groundwater is absent or scarce."
  },
  {
    mode: "points",
    number: "05",
    label: "THE SOURCES BEHIND THE PATTERN",
    title: "Every point is one entry in the public inventory.",
    image: sourceLocationsImage,
    alt: "Dashboard showing individual groundwater-source locations by type",
    shows: "Every dot is one public inventory entry. Colour separates boreholes, dug wells and springs.",
    meaning: "This is a starting list for matching sites with WRA permits, completion records and field observations. Dense and empty areas still reflect how the survey was carried out.",
    caution: "A point does not confirm ownership, operating condition, permit status or current water use."
  },
  {
    mode: "depth",
    number: "06",
    label: "THE SMALL DEPTH SAMPLE",
    title: "Only 552 records support the construction-depth map.",
    image: constructionDepthImage,
    alt: "Dashboard showing groundwater sources with usable construction depth",
    shows: "Colour and marker size compare the 552 records with usable construction depth. Their median construction depth is 75 metres.",
    meaning: "Usable depth evidence is rare and unevenly distributed. It can guide targeted local checks, but it is too limited to describe typical borehole depth across all of Kenya.",
    caution: "This small sample cannot describe depth conditions across the whole country."
  },
  {
    mode: "coverage",
    number: "07",
    label: "SEE THE MISSING VALUES",
    title: "The coverage map makes the depth gap impossible to miss.",
    image: depthCoverageImage,
    alt: "Dashboard comparing records with and without usable construction depth",
    shows: "Green records contain usable construction depth; muted red records do not. Only 2.6% of the inventory has a usable value.",
    meaning: "Missing depth is the clearest limitation in this dataset. Completing and verifying these records would greatly improve groundwater planning, drilling review and future monitoring.",
    caution: "Missing depth is not zero depth, a shallow source or evidence of non-compliance."
  },
  {
    mode: "timeline",
    number: "08",
    label: "WHEN RECORDS CHANGED",
    title: "The timeline follows data updates—not drilling.",
    image: updateTimelineImage,
    alt: "Dashboard showing the groundwater record-update timeline",
    shows: "The view groups records by the date their database entry was last updated. The controls can show one month or the cumulative record up to that month.",
    meaning: "Large peaks represent periods of database activity or bulk updates. They help assess how current the inventory may be, but they do not show when wells were drilled or began operating.",
    caution: "These are record-update dates. They are not construction, permit or abstraction start dates."
  },
  {
    mode: "wells3d",
    number: "09",
    label: "BELOW THE SURFACE",
    title: "Depth shafts place the small sample beneath 3D terrain.",
    image: wellsBelowGroundImage,
    alt: "Dashboard showing construction-depth shafts projected below 3D terrain",
    shows: "Each coloured shaft starts at the terrain surface and extends downward using the recorded construction depth. Display scaling makes the shafts visible at national level.",
    meaning: "The view makes relative drilling depth easier to compare and highlights how small the usable sample is. It can guide record checks, but it does not reveal the shape or condition of an aquifer.",
    caution: "The shafts show relative construction depth, not groundwater level, aquifer shape or pumping capacity."
  }
];

export default function MapAnalysisStory({ onOpenDashboard }) {
  const [active, setActive] = useState(0);
  const chapterRefs = useRef([]);

  useEffect(() => {
    const nodes = chapterRefs.current.filter(Boolean);
    if (!nodes.length || !("IntersectionObserver" in window)) return undefined;

    const observer = new IntersectionObserver(entries => {
      const visible = entries
        .filter(entry => entry.isIntersecting)
        .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
      if (visible) setActive(Number(visible.target.dataset.chapter));
    }, { rootMargin: "-28% 0px -42%", threshold: [0.05, 0.25, 0.5, 0.75] });

    nodes.forEach(node => observer.observe(node));
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (window.location.hash !== "#map-analysis-story") return undefined;
    const timer = window.setTimeout(() => document.getElementById("map-analysis-story")?.scrollIntoView(), 120);
    return () => window.clearTimeout(timer);
  }, []);

  const current = chapters[active];

  return (
    <section className="map-story" id="map-analysis-story" aria-labelledby="map-story-title">
      <header className="map-story-intro">
        <p className="section-label">EXPLORE THE ANALYSIS · NINE MAPS, ONE STORY</p>
        <h2 id="map-story-title">Scroll through every notebook analysis output map and read what the pattern really means.</h2>
        <p>The dashboard views answer different questions. As you move through this section, the map changes while the explanation stays focused on what the data can—and cannot—support.</p>
      </header>

      <div className="map-story-layout">
        <figure className="map-story-stage" aria-live="polite">
          <div className="map-story-screen">
            <img key={current.image} src={current.image} alt={current.alt} />
            <div className="map-story-screen-label"><span>{current.number} / {String(chapters.length).padStart(2, "0")}</span><b>{current.label}</b></div>
          </div>
          <figcaption>
            <span>Notebook outputs · Analysis view</span>
            <b>{current.title}</b>
          </figcaption>
          <div className="map-story-progress" aria-label={`Map ${active + 1} of ${chapters.length}`}>
            {chapters.map((chapter, index) => <i key={chapter.mode} className={index === active ? "is-active" : ""} />)}
          </div>
        </figure>

        <div className="map-story-chapters">
          {chapters.map((chapter, index) => (
            <article
              className={`map-story-chapter ${index === active ? "is-active" : ""}`}
              data-chapter={index}
              key={chapter.mode}
              ref={node => { chapterRefs.current[index] = node; }}
            >
              <div className="map-story-mobile-image"><img src={chapter.image} alt="" /></div>
              <span className="map-story-number">{chapter.number}</span>
              <p className="section-label">{chapter.label}</p>
              <h3>{chapter.title}</h3>
              <p className="map-story-explanation"><b>What the map shows:</b> {chapter.shows}</p>
              <p className="map-story-meaning"><b>What the pattern means:</b> {chapter.meaning}</p>
              <p className="map-story-caution"><b>Read with care:</b> {chapter.caution}</p>
              <button type="button" onClick={() => onOpenDashboard(chapter.mode)}>Open this live map →</button>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
