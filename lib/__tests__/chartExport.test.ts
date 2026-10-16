import { describe, it, expect } from 'vitest';
import { chartTables, toCsv } from '../chartExport';

describe('chartTables', () => {
  it('reads bars and lines as category × series', () => {
    const [table] = chartTables({
      xAxis: { type: 'category', data: ['2023', '2024', { value: '2025' }] },
      yAxis: { type: 'value' },
      series: [
        { type: 'bar', name: 'HAL', data: [3, { value: 5 }, 8] },
        { type: 'line', name: 'OpenAlex', data: [1, 2] },
      ],
    });
    expect(table.columns).toEqual(['Category', 'HAL', 'OpenAlex']);
    expect(table.rows).toEqual([['2023', 3, 1], ['2024', 5, 2], ['2025', 8, null]]);
  });

  it('handles horizontal bars, array items and the axis name', () => {
    const [table] = chartTables({
      xAxis: { type: 'value' },
      yAxis: { type: 'category', name: 'Journal', data: ['A', 'B'] },
      series: [{ type: 'bar', data: [[4, 1], [7, 0]] }],
    });
    expect(table.columns).toEqual(['Journal', 'Value']);
    expect(table.rows).toEqual([['A', 7], ['B', 4]]);
  });

  it('keys lines on a value axis by x, sorted', () => {
    const [table] = chartTables({
      xAxis: { type: 'value' },
      yAxis: { type: 'value' },
      series: [
        { type: 'line', name: 'a', data: [[2021, 1], [2020, 2]] },
        { type: 'line', name: 'b', data: [[2022, 3]] },
      ],
    });
    expect(table.rows).toEqual([[2020, 2, null], [2021, 1, null], [2022, null, 3]]);
  });

  it('reads pies and choropleth maps as name / value', () => {
    expect(chartTables({ series: [{ type: 'pie', data: [{ name: 'Gold', value: 10 }, { name: 'Green', value: 4 }] }] }))
      .toEqual([{ name: 'data', columns: ['Name', 'Value'], rows: [['Gold', 10], ['Green', 4]] }]);
    const [two] = chartTables({
      series: [
        { type: 'pie', name: 'In', data: [{ name: 'x', value: 1 }] },
        { type: 'pie', name: 'Out', data: [{ name: 'y', value: 2 }] },
      ],
    });
    expect(two.columns).toEqual(['Series', 'Name', 'Value']);
    expect(two.rows).toEqual([['In', 'x', 1], ['Out', 'y', 2]]);
  });

  it('reads a heatmap cell by cell with the axis labels', () => {
    const [table] = chartTables({
      xAxis: { type: 'category', data: ['FR', 'DE'] },
      yAxis: { type: 'category', data: ['Team 1'] },
      series: [{ type: 'heatmap', data: [[0, 0, 5], [1, 0, 2]] }],
    });
    expect(table.columns).toEqual(['Row', 'Column', 'Value']);
    expect(table.rows).toEqual([['Team 1', 'FR', 5], ['Team 1', 'DE', 2]]);
  });

  it('exports map points and leaves the flow lines out', () => {
    const tables = chartTables({
      geo: { map: 'world' },
      series: [
        { type: 'lines', coordinateSystem: 'geo', data: [{ coords: [[0, 0], [1, 1]], value: 3 }] },
        { type: 'effectScatter', name: 'partners', coordinateSystem: 'geo', data: [{ name: 'MIT', value: [-71, 42, 3] }] },
        { type: 'scatter', name: 'origin', coordinateSystem: 'geo', data: [{ name: 'Nantes', value: [-1.5, 47.2] }] },
      ],
    });
    expect(tables).toHaveLength(1);
    expect(tables[0].columns).toEqual(['Series', 'Name', 'Longitude', 'Latitude', 'Value']);
    expect(tables[0].rows).toEqual([['partners', 'MIT', -71, 42, 3], ['origin', 'Nantes', -1.5, 47.2, null]]);
  });

  it('splits a network into nodes and links named by node', () => {
    const tables = chartTables({
      series: [{
        type: 'graph',
        categories: [{ name: 'Lab' }, { name: 'Author' }],
        nodes: [{ id: 'l1', name: 'LS2N', category: 0, value: 40 }, { id: 'a1', name: 'Doe', category: 1, value: 5 }],
        links: [{ source: 'l1', target: 'a1', value: 5 }, { source: 0, target: 1 }],
      }],
    });
    expect(tables.map((t) => t.name)).toEqual(['nodes', 'links']);
    expect(tables[0].rows).toEqual([['LS2N', 'Lab', 40], ['Doe', 'Author', 5]]);
    expect(tables[1].rows).toEqual([['LS2N', 'Doe', 5], ['LS2N', 'Doe', null]]);
  });

  it('reads sankey links', () => {
    const [table] = chartTables({
      series: [{ type: 'sankey', data: [{ name: 'A' }, { name: 'B' }], links: [{ source: 'A', target: 'B', value: 2 }] }],
    });
    expect(table.rows).toEqual([['A', 'B', 2]]);
  });

  it('flattens a sunburst, summing the inner nodes without value', () => {
    const [table] = chartTables({
      series: [{
        type: 'sunburst',
        data: [{ name: 'T1', children: [{ name: 'FR', value: 3 }, { name: 'DE', children: [{ name: 'TUM', value: 2 }] }] }],
      }],
    });
    expect(table.columns).toEqual(['Level 1', 'Level 2', 'Level 3', 'Value']);
    expect(table.rows).toEqual([
      ['T1', null, null, 5],
      ['T1', 'FR', null, 3],
      ['T1', 'DE', null, 2],
      ['T1', 'DE', 'TUM', 2],
    ]);
  });

  it('reads a radar as indicator × profile', () => {
    const [table] = chartTables({
      radar: { indicator: [{ name: 'Physics', max: 100 }, { name: 'Chemistry', max: 100 }] },
      series: [{ type: 'radar', data: [{ name: 'Team A', value: [60, 40] }, { name: 'Team B', value: [10, 90] }] }],
    });
    expect(table.columns).toEqual(['Indicator', 'Team A', 'Team B']);
    expect(table.rows).toEqual([['Physics', 60, 10], ['Chemistry', 40, 90]]);
  });

  it('returns nothing for an empty or unreadable option', () => {
    expect(chartTables(null)).toEqual([]);
    expect(chartTables({ series: [] })).toEqual([]);
    expect(chartTables({ xAxis: { type: 'category', data: [] }, series: [{ type: 'bar', data: [] }] })).toEqual([]);
  });
});

describe('toCsv', () => {
  it('writes a French spreadsheet CSV', () => {
    const csv = toCsv({ name: 'data', columns: ['Name', 'Value'], rows: [['Ré "x"', 12.5], ['=HYPERLINK()', null]] });
    expect(csv).toBe('"Name";"Value"\r\n"Ré ""x""";12,5\r\n"\'=HYPERLINK()";');
  });
});
