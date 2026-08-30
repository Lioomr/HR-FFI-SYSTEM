import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

/**
 * Leaflet and react-leaflet are stubbed so the suite never touches a tile
 * server and never needs a real DOM map instance. The stubs expose the props
 * the picker passes down, which is exactly what these tests assert on.
 */
const harness = vi.hoisted(() => ({
  mapEventHandlers: null as Record<string, (event: any) => void> | null,
  map: {
    fitBounds: vi.fn(),
    setView: vi.fn(),
    getZoom: () => 16,
  },
}));

vi.mock("react-leaflet", () => ({
  MapContainer: ({ children, center, zoom }: any) => (
    <div
      data-testid="map-container"
      data-center={JSON.stringify(center)}
      data-zoom={String(zoom)}
    >
      {children}
    </div>
  ),
  TileLayer: ({ url, attribution }: any) => (
    <div
      data-testid="tile-layer"
      data-url={url}
      data-attribution={attribution}
    />
  ),
  Circle: ({ center, radius }: any) => (
    <div
      data-testid="circle"
      data-radius={String(radius)}
      data-center={JSON.stringify(center)}
    />
  ),
  Marker: ({ position, draggable, eventHandlers }: any) => (
    <button
      type="button"
      data-testid="marker"
      data-position={JSON.stringify(position)}
      data-draggable={String(draggable)}
      onClick={() =>
        eventHandlers?.dragend?.({
          target: { getLatLng: () => ({ lat: 25.111111, lng: 47.222222 }) },
        })
      }
    />
  ),
  useMap: () => harness.map,
  useMapEvents: (handlers: Record<string, (event: any) => void>) => {
    harness.mapEventHandlers = handlers;
    return harness.map;
  },
}));

vi.mock("leaflet", () => ({
  default: {
    divIcon: vi.fn(() => ({ stubIcon: true })),
    latLng: (lat: number, lng: number) => ({
      lat,
      lng,
      toBounds: (radius: number) => ({
        stubBounds: true,
        center: { lat, lng },
        radius,
      }),
    }),
  },
}));

import WorkLocationMapPicker from "./WorkLocationMapPicker";
import { MAP_TILE_ATTRIBUTION, MAP_TILE_URL } from "../../config/mapConfig";
import { useI18nStore } from "../../i18n/i18nStore";

beforeEach(() => {
  harness.mapEventHandlers = null;
  harness.map.fitBounds.mockReset();
  harness.map.setView.mockReset();
  useI18nStore.getState().setLanguage("en");
});

describe("invalid or incomplete coordinates", () => {
  it("shows the placeholder instead of a map when coordinates are empty", () => {
    render(
      <WorkLocationMapPicker
        latitude=""
        longitude=""
        radiusMeters={100}
        onChange={vi.fn()}
      />,
    );

    expect(screen.getByTestId("map-placeholder")).toBeInTheDocument();
    expect(screen.queryByTestId("map-container")).not.toBeInTheDocument();
  });

  it("shows the placeholder for out-of-range and unparsable values", () => {
    const cases: [unknown, unknown][] = [
      ["95.000000", "46.675300"],
      ["24.713600", "200.000000"],
      ["abc", "46.675300"],
      [undefined, undefined],
    ];

    for (const [lat, lng] of cases) {
      const { unmount } = render(
        <WorkLocationMapPicker
          latitude={lat}
          longitude={lng}
          radiusMeters={100}
          onChange={vi.fn()}
        />,
      );
      expect(screen.getByTestId("map-placeholder")).toBeInTheDocument();
      expect(screen.queryByTestId("map-container")).not.toBeInTheDocument();
      unmount();
    }
  });
});

describe("rendering with valid coordinates", () => {
  it("renders the map centred on the coordinates", () => {
    render(
      <WorkLocationMapPicker
        latitude="24.713600"
        longitude="46.675300"
        radiusMeters={100}
        onChange={vi.fn()}
      />,
    );

    expect(screen.getByTestId("map-container")).toHaveAttribute(
      "data-center",
      JSON.stringify([24.7136, 46.6753]),
    );
    expect(screen.queryByTestId("map-placeholder")).not.toBeInTheDocument();
  });

  it("uses the configured tile URL and shows attribution", () => {
    render(
      <WorkLocationMapPicker
        latitude="24.713600"
        longitude="46.675300"
        radiusMeters={100}
        onChange={vi.fn()}
      />,
    );

    const tiles = screen.getByTestId("tile-layer");
    expect(tiles).toHaveAttribute("data-url", MAP_TILE_URL);
    expect(tiles).toHaveAttribute("data-attribution", MAP_TILE_ATTRIBUTION);
    expect(MAP_TILE_ATTRIBUTION).toContain("OpenStreetMap");
  });
});

describe("radius circle", () => {
  it("draws the circle with the radius field's exact value in metres", () => {
    render(
      <WorkLocationMapPicker
        latitude="24.713600"
        longitude="46.675300"
        radiusMeters={100}
        onChange={vi.fn()}
      />,
    );

    expect(screen.getByTestId("circle")).toHaveAttribute("data-radius", "100");
  });

  it("updates the circle immediately when the radius changes", () => {
    const { rerender } = render(
      <WorkLocationMapPicker
        latitude="24.713600"
        longitude="46.675300"
        radiusMeters={100}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByTestId("circle")).toHaveAttribute("data-radius", "100");

    rerender(
      <WorkLocationMapPicker
        latitude="24.713600"
        longitude="46.675300"
        radiusMeters={250}
        onChange={vi.fn()}
      />,
    );

    expect(screen.getByTestId("circle")).toHaveAttribute("data-radius", "250");
  });

  it("omits the circle when the radius is missing or not positive", () => {
    render(
      <WorkLocationMapPicker
        latitude="24.713600"
        longitude="46.675300"
        radiusMeters={undefined}
        onChange={vi.fn()}
      />,
    );

    expect(screen.queryByTestId("circle")).not.toBeInTheDocument();
    expect(screen.getByTestId("marker")).toBeInTheDocument();
  });
});

describe("auto fit", () => {
  it("fits the viewport to the whole circle when a radius is set", () => {
    render(
      <WorkLocationMapPicker
        latitude="24.713600"
        longitude="46.675300"
        radiusMeters={250}
        onChange={vi.fn()}
      />,
    );

    expect(harness.map.fitBounds).toHaveBeenCalledWith(
      expect.objectContaining({ stubBounds: true, radius: 250 }),
      expect.objectContaining({ padding: [24, 24] }),
    );
  });

  it("refits after the radius grows", () => {
    const { rerender } = render(
      <WorkLocationMapPicker
        latitude="24.713600"
        longitude="46.675300"
        radiusMeters={100}
        onChange={vi.fn()}
      />,
    );
    harness.map.fitBounds.mockClear();

    rerender(
      <WorkLocationMapPicker
        latitude="24.713600"
        longitude="46.675300"
        radiusMeters={900}
        onChange={vi.fn()}
      />,
    );

    expect(harness.map.fitBounds).toHaveBeenCalledWith(
      expect.objectContaining({ radius: 900 }),
      expect.anything(),
    );
  });

  it("recentres without fitting when there is no usable radius", () => {
    render(
      <WorkLocationMapPicker
        latitude="24.713600"
        longitude="46.675300"
        radiusMeters={0}
        onChange={vi.fn()}
      />,
    );

    expect(harness.map.fitBounds).not.toHaveBeenCalled();
    expect(harness.map.setView).toHaveBeenCalledWith(
      { lat: 24.7136, lng: 46.6753 },
      16,
    );
  });

  it("recentres when new coordinates are pasted in", () => {
    const { rerender } = render(
      <WorkLocationMapPicker
        latitude="24.713600"
        longitude="46.675300"
        radiusMeters={100}
        onChange={vi.fn()}
      />,
    );
    harness.map.fitBounds.mockClear();

    rerender(
      <WorkLocationMapPicker
        latitude="21.422500"
        longitude="39.826200"
        radiusMeters={100}
        onChange={vi.fn()}
      />,
    );

    expect(screen.getByTestId("map-container")).toHaveAttribute(
      "data-center",
      JSON.stringify([21.4225, 39.8262]),
    );
    expect(harness.map.fitBounds).toHaveBeenCalled();
  });
});

describe("picking a centre", () => {
  it("reports the clicked point", () => {
    const onChange = vi.fn();
    render(
      <WorkLocationMapPicker
        latitude="24.713600"
        longitude="46.675300"
        radiusMeters={100}
        onChange={onChange}
      />,
    );

    harness.mapEventHandlers?.click({
      latlng: { lat: 26.333333, lng: 43.977778 },
    });

    expect(onChange).toHaveBeenCalledWith(26.333333, 43.977778);
  });

  it("reports the marker's position after a drag", () => {
    const onChange = vi.fn();
    render(
      <WorkLocationMapPicker
        latitude="24.713600"
        longitude="46.675300"
        radiusMeters={100}
        onChange={onChange}
      />,
    );

    fireEvent.click(screen.getByTestId("marker"));

    expect(onChange).toHaveBeenCalledWith(25.111111, 47.222222);
  });

  it("ignores clicks and disables dragging when disabled", () => {
    const onChange = vi.fn();
    render(
      <WorkLocationMapPicker
        latitude="24.713600"
        longitude="46.675300"
        radiusMeters={100}
        onChange={onChange}
        disabled
      />,
    );

    harness.mapEventHandlers?.click({
      latlng: { lat: 26.333333, lng: 43.977778 },
    });

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByTestId("marker")).toHaveAttribute(
      "data-draggable",
      "false",
    );
  });
});
