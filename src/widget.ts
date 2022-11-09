// Copyright (c) TileDB
// Distributed under the terms of the MIT License.

import {
  DOMWidgetModel,
  DOMWidgetView,
  ISerializers
} from '@jupyter-widgets/base';
import * as d3 from 'd3';
import debounce from './debounce';
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
  x: number;
  y: number;
  id: string;
  index: number;
  name: string;
  status: string;
}

interface Link {
  parent: NodeDetails;
  child: NodeDetails;
}

const NODE_SIZE = 15;

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
   * we return the new height and how much it was scaled down
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
    const {
      nodes,
      edges,
      node_details: serverDetails,
      positions
    } = this.data as ServerGraph;
    const [MAX_WIDTH, MAX_HEIGHT] = this.calculateBounds(positions);
    const [height, scaleY] = this.getHeightScale(MAX_HEIGHT, MAX_WIDTH);
    const svg = d3.select(this.el).select('svg');
    const circleSize = this.getNodeSize(scaleY);
    const widthWithPadding = MAX_WIDTH + circleSize;
    /**
     * We clamp width of the svg to be at least 15 times biggger than the node's size so nodes
     * don't look really big and take big part of the screen, this was evident for graphs with 1-2 nodes.
     */
    const viewBoxWidth = clamp(
      NODE_SIZE * 15,
      widthWithPadding,
      widthWithPadding
    );
    const horizontalOffset = (viewBoxWidth - widthWithPadding) / 2;
    const numberOfNodes = nodes.length;
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

    if (horizontalOffset) {
      const group = this.svg.select('g');

      group.attr('transform', `translate(${horizontalOffset})`);
    }
    /**
     * During initialization the wrapper elemete (this.el) has no width,
     * we wait for that before we do any DOM calculations.
     */
    if (!this.initialized) {
      await poll(() => this.el.offsetWidth > 0, 300);
    }
    const lessThanThirtyNodes = numberOfNodes < 30;
    const additionalCssClasses = lessThanThirtyNodes ? 'node--small' : '';

    /**
     * Sometimes during updates we are getting different/weird positions object
     * So we save and re-use the first positions object we are getting
     */
    this.positions = this.positions || positions;
    if (!this.initialized) {
      this.zoom(MAX_WIDTH, height);
    }

    const clientMap = Object.fromEntries(
      Object.entries(serverDetails).map(
        ([nodeId, nodeData], i): [string, NodeDetails] => {
          const nodePosition = this.positions![nodeId];
          const [rawX, rawY] = nodePosition;

          const x = rawX + circleSize / 2;
          const y = (MAX_HEIGHT - rawY) * scaleY;

          return [
            nodeId,
            {
              index: i,
              name: nodeData.name,
              status: nodeData.status,
              id: nodeId,
              x,
              y
            }
          ];
        }
      )
    );
    const clientNodeList = Object.values(clientMap);

    const links: Link[] = edges.map(([parent, child]) => ({
      parent: clientMap[parent],
      child: clientMap[child]
    }));

    const lines = this.wrapper.selectAll('path').data(links);

    lines.join(
      (enter: any) => {
        enter
          .append('path')
          .attr('d', (d: Link) => {
            return `M${d.parent.x},${d.parent.y} C ${d.parent.x},${
              (d.parent.y + d.child.y) / 2
            } ${d.child.x},${(d.parent.y + d.child.y) / 2} ${d.child.x},${
              d.child.y
            }`;
          })
          .attr('class', (d: Link) => `path-${toCSSClass(d.child.status)}`);
      },
      (update: any) =>
        update.attr('class', (d: Link) => `path-${toCSSClass(d.child.status)}`)
    );

    const circles = this.wrapper.selectAll('circle').data(clientNodeList);

    circles.join(
      (enter: any) => {
        enter
          .append('circle')
          .attr('cx', (d: NodeDetails) => d.x)
          .attr('cy', (d: NodeDetails) => d.y)
          .attr('r', circleSize)
          .attr(
            'class',
            (d: NodeDetails) =>
              `${toCSSClass(d.status)} ${additionalCssClasses}`
          )
          .on('mouseover', (event: any, d: NodeDetails) => {
            const caption = d.name || d.id;
            this.tooltip.transition().duration(200).style('opacity', 0.9);
            this.tooltip
              .html(
                `<p class="tiledb-plot-tooltip">${caption}: <b>${d.status}</b></p>`
              )
              .style('left', `${event.offsetX + 10}px`)
              .style('top', `${event.offsetY + 10}px`);
          })
          .on('mouseout', () => {
            this.tooltip.transition().duration(500).style('opacity', 0);
          });
      },
      (update: any) => {
        update.attr(
          'class',
          (d: NodeDetails) => `${toCSSClass(d.status)} ${additionalCssClasses}`
        );
      },
      (exit: any) => {
        exit.on('mouseover', null).on('mouseout', null).remove();
      }
    );
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
