// Copyright (c) TileDB
// Distributed under the terms of the MIT License.

import {
  DOMWidgetModel,
  DOMWidgetView,
  ISerializers
} from '@jupyter-widgets/base';
import * as d3 from 'd3';
import debounce from './debounce';
import workerURL from 'file-loader!../lib/worker.js';
import { MODULE_NAME, MODULE_VERSION } from './version';
import { poll } from './poll';
import clamp from './clamp';

interface NodeData {
  status: string;
  name: string;
}

interface Positions {
  [s: string]: [number, number];
}

interface ServerGraph {
  nodes: string[];
  edges: Array<[string, string]>;
  node_details: {
    [s: string]: NodeData;
  };
  root_nodes?: string[];
  positions: Positions;
}

interface NodeDetails {
  fx: number;
  fy: number;
  id: string;
  index: number;
  name: string;
  status: string;
  x: number;
  y: number;
}

interface Link {
  source: NodeDetails;
  target: NodeDetails;
}

interface WorkerData {
  type: string;
  nodes: NodeDetails[];
  links: Link[];
}

const NODE_SIZE = 15;
// const PADDING = 20;

export class DagVisualizeModel extends DOMWidgetModel {
  defaults(): any {
    return {
      ...super.defaults(),
      _model_name: DagVisualizeModel.model_name,
      _model_module: DagVisualizeModel.model_module,
      _model_module_version: DagVisualizeModel.model_module_version,
      _view_name: DagVisualizeModel.view_name,
      _view_module: DagVisualizeModel.view_module,
      _view_module_version: DagVisualizeModel.view_module_version,
      value: ''
    };
  }

  static serializers: ISerializers = {
    ...DOMWidgetModel.serializers
    // Add any extra serializers here
  };

  static model_name = 'DagVisualizeModel';
  static model_module = MODULE_NAME;
  static model_module_version = MODULE_VERSION;
  static view_name = 'DagVisualizeView'; // Set to null if no view
  static view_module = MODULE_NAME; // Set to null if no view
  static view_module_version = MODULE_VERSION;
}
export class DagVisualizeView extends DOMWidgetView {
  data: ServerGraph | undefined;
  transform: any;
  svg: any;
  wrapper: any;
  tooltip: any;
  verticalOffset: number | undefined;
  bounds: [number, number] | undefined;
  initialized: boolean | undefined;
  positions: Positions | undefined;

  render(): void {
    this.el.classList.add('tiledb-widget');
    this.createSVG();
    this.value_changed();
    /**
     * Debounce rendering function so it won't rerender too fast
     */
    const debouncedOnChange = debounce(this.value_changed.bind(this), 1500);
    this.model.on('change:value', debouncedOnChange as any, this);
  }

  value_changed(): void {
    this.data = JSON.parse(this.model.get('value'));
    /**
     * Reset html and build new graph
     */
    this.createDag();
  }

  calculateBounds(positions: Positions): [number, number] {
    if (typeof this.bounds === 'undefined') {
      const xNums = Object.values(positions).map(pos => pos[0]);
      const yNums = Object.values(positions).map(pos => pos[1]);
      const padding = 30;
      const verticalPadding = 60;
      const maxHorizontalCoordinate = Math.max(...xNums);
      const maxVerticalCoordinate = Math.max(...yNums);

      this.bounds = [
        maxHorizontalCoordinate + padding,
        maxVerticalCoordinate + verticalPadding
      ];
    }

    return this.bounds as [number, number];
  }

  createSVG(): void {
    this.wrapper = d3.select(this.el).append('svg').append('g');
    this.svg = d3.select(this.el).select('svg');
    this.createControls();
    this.createTooltip();
  }

  zoom(width: number, height: number): void {
    const svg = this.svg;

    const zoom = d3
      .zoom()
      .translateExtent([
        [0, 0],
        [width, height]
      ])
      .on('zoom', (zoomEvent: any) => {
        this.wrapper.attr('transform', zoomEvent.transform);
      });

    svg.call(zoom).on('wheel.zoom', null);

    function zoomHandler(this: any) {
      d3.event?.preventDefault();
      const direction = this.id === 'zoom_in' ? 0.2 : -0.2;
      /**
       * In SVG 1.1 <svg> elements did not support transform attributes. In SVG 2 it is proposed that they should.
       * Chrome and Firefox implement this part of the SVG 2 specification, Safari does not yet do so and IE11 never will.
       * That's why we apply transform to the "g" element instead of the "svg"
       */
      svg
        .transition()
        .duration(300)
        .call(zoom.scaleBy as any, 1 + direction);
    }

    function resetHandler(this: any) {
      svg.transition().duration(300).call(zoom.transform, d3.zoomIdentity);
    }

    setTimeout(() => {
      d3.select(this.el).selectAll('.zoomControl').on('click', zoomHandler);
      d3.select(this.el).selectAll('.resetControl').on('click', resetHandler);
    }, 0);
    this.initialized = true;
  }

  createTooltip(): void {
    this.tooltip = d3
      .select(this.el)
      .append('div')
      .attr('class', 'tooltip')
      .style('opacity', 0);
  }

  getRootNodes(
    nodes: ServerGraph['nodes'],
    edges: ServerGraph['edges']
  ): string[] {
    const hasNoParent = (node: string) =>
      edges.every(([, parent]: string[]) => node !== parent);

    return nodes.filter(hasNoParent);
  }

  /**
   * Calculate the size of the nodes, if we squeeze the visualization vertically
   * we return the default node size times the scale we have done. (e.g. 15 * 0.6)
   * @param scaleY How much the visualization has been scaled down vertically
   */
  getNodeSize(scaleY: number): number {
    return NODE_SIZE * scaleY * 0.8;
  }

  /**
   * We squeeze vertically the visualization in case it is too tall
   */
  getHeightScale(height: number, width: number): [number, number] {
    const MAX_HEIGHT_RATIO = 0.7;
    const MIN_HEIGHT_RATIO = 0.3;
    const upperBound = width * MAX_HEIGHT_RATIO;
    const lowerBound = width * MIN_HEIGHT_RATIO;
    const clampedHeight = clamp(lowerBound, upperBound, height);

    return [clampedHeight, clampedHeight / height];
  }

  async createDag(): Promise<void> {
    const { nodes, edges, node_details, positions } = this.data as ServerGraph;
    const [MAX_WIDTH, MAX_HEIGHT] = this.calculateBounds(positions);
    const [height, scaleY] = this.getHeightScale(MAX_HEIGHT, MAX_WIDTH);
    const svg = d3.select(this.el).select('svg');
    const circleSize = this.getNodeSize(scaleY);
    const viewBoxWidth = MAX_WIDTH + circleSize;
    /**
     * In case plot is really big the edges betweend nodes are faint, make them bolder
     */
    const pathsShouldBeBolder = viewBoxWidth > 5000;

    svg
      .attr('preserveAspectRatio', 'xMinYMin meet')
      .attr('viewBox', `0 0 ${viewBoxWidth} ${height}`);

    if (pathsShouldBeBolder) {
      svg.attr('class', 'tiledb-plot--bolder');
    }
    /**
     * During initialization the wrapper elemete (this.el) has no width,
     * we wait for that before we do any DOM calculations.
     */
    if (!this.initialized) {
      await poll(() => this.el.offsetWidth > 0, 300);
    }
    const numberOfNodes = nodes.length;
    const lessThanThirtyNodes = numberOfNodes < 30;
    const smallNodeClass = lessThanThirtyNodes ? 'node--small' : '';

    /**
     * Sometimes during updates we are getting different/weird positions object
     * So we save and re-use the first positions object we are getting
     */
    this.positions = this.positions || positions;
    if (!this.initialized) {
      this.zoom(MAX_WIDTH, height);
    }

    const links = edges.map(([parent, child]) => ({
      source: parent,
      target: child
    }));

    const nodeDetails: NodeDetails[] = Object.entries(node_details).map(
      ([nodeId, nodeData], i) => {
        const nodePosition = (this.positions as Positions)[nodeId];
        const [rawX, rawY] = nodePosition;

        const x = rawX + circleSize / 2;
        const y = (MAX_HEIGHT - rawY) * scaleY;

        return {
          index: i,
          name: nodeData.name,
          status: nodeData.status,
          id: nodeId,
          fx: x,
          fy: y,
          x,
          y
        };
      }
    );

    const worker = new Worker(workerURL);
    worker.postMessage({
      nodes: nodeDetails,
      links
    });
    worker.onmessage = (event: MessageEvent<WorkerData>) => {
      if (event.data.type !== 'end') {
        return;
      }

      const { nodes, links } = event.data;

      const lines = this.wrapper.selectAll('path').data(links);

      lines.join(
        (enter: any) => {
          enter
            .append('path')
            .attr('d', (d: Link) => {
              return `M${d.source.x},${d.source.y} C ${d.source.x},${
                (d.source.y + d.target.y) / 2
              } ${d.target.x},${(d.source.y + d.target.y) / 2} ${d.target.x},${
                d.target.y
              }`;
            })
            .attr('class', (d: Link) => `path-${toCSSClass(d.target.status)}`);
        },
        (update: any) =>
          update.attr(
            'class',
            (d: Link) => `path-${toCSSClass(d.target.status)}`
          )
      );

      const circles = this.wrapper.selectAll('circle').data(nodes);

      circles.join(
        (enter: any) => {
          enter
            .append('circle')
            .attr('cx', (d: NodeDetails) => d.x)
            .attr('cy', (d: NodeDetails) => d.y)
            .attr('r', circleSize)
            .attr(
              'class',
              (d: NodeDetails) => `${toCSSClass(d.status)} ${smallNodeClass}`
            )
            .on('mouseover', (event: any, d: NodeDetails) => {
              const caption = d.name || d.id;

              this.tooltip.transition().duration(200).style('opacity', 0.9);
              this.tooltip
                .html(
                  `<p class="tiledb-plot-tooltip">${caption}: <b>${d.status}</b></p>`
                )
                .style('left', `${event.clientX + 10}px`)
                .style('top', `${event.clientY + 10}px`);
            })
            .on('mouseout', () => {
              this.tooltip.transition().duration(500).style('opacity', 0);
            });
        },
        (update: any) => {
          update.attr(
            'class',
            (d: NodeDetails) => `${toCSSClass(d.status)} ${smallNodeClass}`
          );
        },
        (exit: any) => {
          exit.on('mouseover', null).on('mouseout', null).remove();
        }
      );
    };
  }

  createControls(): void {
    const zoomInButton = document.createElement('button');
    const zoomOutButton = document.createElement('button');
    const resetButton = document.createElement('button');
    const className = 'zoomControl';
    zoomInButton.id = 'zoom_in';
    zoomOutButton.id = 'zoom_out';
    resetButton.className = 'resetControl';
    zoomInButton.className = className;
    zoomOutButton.className = className;

    this.el.append(zoomInButton);
    this.el.append(zoomOutButton);
    this.el.append(resetButton);
  }
}

function toCSSClass(status: string): string {
  return status.toLowerCase().replace(/[ _]/g, '-');
}
