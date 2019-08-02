import React from 'react';
import styled from 'styled-components';
import { interpret, Interpreter } from 'xstate/lib/interpreter';
import {
  Machine as _Machine,
  StateNode,
  State,
  EventObject,
  Machine,
  assign
} from 'xstate';
import * as XState from 'xstate';
import { Edge as XStateEdge } from 'xstate';
import { getEdges } from 'xstate/lib/graph';
import { StateChartNode, StateChartNodeEvent } from './StateChartNode';

import { serializeEdge, isHidden, initialStateNodes } from './utils';
import { Edge } from './Edge';
import { tracker } from './tracker';
import { Editor } from './Editor';
import { InitialEdge } from './InitialEdge';
import { toStatePaths } from 'xstate/lib/utils';

const StyledViewTab = styled.li`
  padding: 0 1rem;
  border-bottom: 2px solid transparent;
  list-style: none;
  text-transform: uppercase;
  user-select: none;
  cursor: pointer;
  display: flex;
  justify-content: center;
  align-items: center;

  &:not([data-active]):hover {
    border-color: var(--color-secondary-light);
  }

  &[data-active] {
    border-color: var(--color-secondary);
  }
`;

const StyledViewTabs = styled.ul`
  display: flex;
  width: 100%;
  height: 100%;
  flex-direction: row;
  justify-content: flex-start;
  align-items: stretch;
  margin: 0;
  padding: 0;
  flex-grow: 0;
  flex-shrink: 0;
`;

const StyledSidebar = styled.div`
  background-color: var(--color-sidebar);
  color: white;
  overflow: hidden;
  display: grid;
  grid-template-columns: 1fr;
  grid-template-rows: 2rem 1fr;
  border-radius: 0.5rem;
  box-shadow: 0 0.5rem 1rem rgba(0,0,0,0.2);
`;

const StyledView = styled.div`
  display: flex;
  flex-direction: column;
  justify-content: flex-start;
  align-items: stretch;
  overflow: hidden;
`;

const StyledStateChart = styled.div`
  display: grid;
  grid-template-columns: 1fr 25rem;
  grid-template-rows: auto;
  font-family: sans-serif;
  font-size: 12px;
  overflow: hidden;
  max-height: inherit;
  padding: 1rem;

  > * {
    max-height: inherit;
    overflow-y: auto;
  }
  &.chart-only {
    display: block;
  }
`;

const StyledField = styled.div`
  padding: 0.5rem 1rem;
  width: 100%;
  overflow: hidden;

  > label {
    text-transform: uppercase;
    display: block;
    margin-bottom: 0.5em;
    font-weight: bold;
  }
`;

const StyledPre = styled.pre`
  overflow: auto;
`;
interface FieldProps {
  label: string;
  children: any;
  disabled?: boolean;
  style?: any;
}
function Field({ label, children, disabled, style }: FieldProps) {
  return (
    <StyledField
      style={{ ...style, ...(disabled ? { opacity: 0.5 } : undefined) }}
    >
      <label>{label}</label>
      {children}
    </StyledField>
  );
}

export enum StateChartViewType {
  ChartOnly ='chart-only',
  Definition = 'definition',
  State = 'state'
}

interface StateChartProps {
  className?: string;
  machine: StateNode<any> | string;
  height?: number | string;
  view?: StateChartViewType;
  hideRootHeader?: boolean;
  onSelectionChange?: (stateChartNode: StateChartNode) => void;
  onEvent?: (stateChartNodeEvent: StateChartNodeEvent) => void;
  onTransition?: (state: State<any, XState.OmniEventObject<EventObject>>) => void;
}

interface StateChartState {
  machine: StateNode<any>;
  current: State<any, any>;
  preview?: State<any, any>;
  previewEvent?: string;
  hideRootHeader?: boolean;
  history: StateChartNode[];
  view: StateChartViewType;
  code: string;
  toggledStates: Record<string, boolean>;
  service: Interpreter<any>;
  error?: any;
}

function toMachine(machine: StateNode<any> | string): StateNode<any> {
  if (typeof machine !== 'string') {
    return machine;
  }

  let createMachine: Function;

  try {
    createMachine = new Function(
      'Machine',
      'interpret',
      'assign',
      'XState',
      machine
    );
  } catch (e) {
    throw e;
  }

  let resultMachine: StateNode<any>;

  const machineProxy = (config: any, options: any, ctx: any) => {
    resultMachine = Machine(config, options, ctx);

    console.log(resultMachine);

    return resultMachine;
  };

  createMachine(machineProxy, interpret, assign, XState);

  return resultMachine! as StateNode<any>;
}

const StyledVisualization = styled.div`
  position: relative;
  max-height: inherit;
  overflow-y: auto;
`;

const StyledStateViewActions = styled.ul`
  margin: 0;
  padding: 0;
  list-style: none;
`;

const StyledStateViewAction = styled.li`
  white-space: nowrap;
  overflow-x: auto;
`;

export class StateChart extends React.Component<
  StateChartProps,
  StateChartState
> {
  selected?: StateChartNode;
  stateChartNodes: StateChartNode[] = [];
  state: StateChartState = (() => {
    const machine = toMachine(this.props.machine);
    // const machine = this.props.machine;

    return {
      current: machine.initialState,
      preview: undefined,
      previewEvent: undefined,
      hideRootHeader: this.props.hideRootHeader,
      history: [],
      view: this.props.view || StateChartViewType.Definition,
      machine: machine,
      code:
        typeof this.props.machine === 'string'
          ? this.props.machine
          : `Machine(${JSON.stringify(machine.config, null, 2)})`,
      toggledStates: {},
      service: interpret(machine, {}).onTransition((current) => {
        this.trackTransitionHistory(current);
        this.setState({ current }, () => {
          if (this.state.previewEvent) {
            this.setState({
              preview: this.state.service.nextState(this.state.previewEvent)
            });
          }
        });
        if (this.props.onTransition) {
          this.props.onTransition(current);          
        }
    })
    };
  })();
  svgRef = React.createRef<SVGSVGElement>();
  componentDidMount() {
    this.state.service.start();
  }
  trackTransitionHistory(transitionState: State<any, any>) {
    for (const stateChartNode of this.stateChartNodes) {
      const stateValue = stateChartNode.props.stateNode.path.join('.');
      // add parent and child states to history
      if (transitionState.history && transitionState.history.matches(stateValue)) {
        // built-in events need to be manually set to identify the transition
        stateChartNode.addSelectedEvent(transitionState.event.type);
        if (!this.state.history.includes(stateChartNode)) {
          // only add the stateChartNode to history once
          this.state.history.push(stateChartNode);
          this.setState({ history: this.state.history });    
        }
      }
    }
  }
  renderView() {
    const { view, current, machine, code } = this.state;

    switch (view) {
      case 'definition':
        return (
          <Editor
            code={this.state.code}
            onChange={code => this.updateMachine(code)}
          />
        );
      case 'state':
        return (
          <>
            <div style={{ overflowY: 'auto' }}>
              <Field label="Value">
                <StyledPre>{JSON.stringify(current.value, null, 2)}</StyledPre>
              </Field>
              <Field label="Context" disabled={!current.context}>
                {current.context !== undefined ? (
                  <StyledPre>
                    {JSON.stringify(current.context, null, 2)}
                  </StyledPre>
                ) : null}
              </Field>
              <Field label="Actions" disabled={!current.actions.length}>
                {!!current.actions.length && (
                  <StyledPre>
                    {JSON.stringify(current.actions, null, 2)}
                  </StyledPre>
                )}
              </Field>
            </div>
            <Field
              label="Event"
              style={{
                marginTop: 'auto',
                borderTop: '1px solid #777',
                flexShrink: 0,
                background: 'var(--color-sidebar)'
              }}
            >
              <Editor
                height="5rem"
                code={'{type: ""}'}
                changeText="Send event"
                onChange={code => {
                  try {
                    const eventData = eval(`(${code})`);

                    this.state.service.send(eventData);
                  } catch (e) {
                    console.error(e);
                    alert(
                      'Unable to send event.\nCheck the console for more info.'
                    );
                  }
                }}
              />
            </Field>
          </>
        );
      default:
        return null;
    }
  }
  updateMachine(code: string) {
    let machine: StateNode;

    try {
      machine = toMachine(code);
    } catch (e) {
      console.error(e);
      alert(
        'Error: unable to update the machine.\nCheck the console for more info.'
      );
      return;
    }

    this.reset(code, machine);
  }
  reset(code = this.state.code, machine = this.state.machine) {
    this.state.service.stop();
    this.stateChartNodes.forEach(stateChartNode => stateChartNode.reset());
    this.setState(
      {
        code,
        machine,
        current: machine.initialState,
        history: []
      },
      () => {
        this.setState(
          {
            service: interpret(this.state.machine)
              .onTransition(current => {
                this.trackTransitionHistory(current);
                this.setState({ current }, () => {
                  if (this.state.previewEvent) {
                    this.setState({
                      preview: this.state.service.nextState(
                        this.state.previewEvent
                      )
                    });
                  }
                });
              })
              .start()
          },
          () => {
            console.log(this.state.service);
          }
        );
      }
    );
  }
  selectStateNodePath(path: string[]) {
    for (const stateChartNode of this.stateChartNodes) {
      let index = 0;
      for (const part of path) {
        // attempt to match all path parts
        if (stateChartNode.props.stateNode.path[index] !== part) {
          break; // not a match
        } else if (index === path.length - 1) {
          // found the stateChartNode to select
          this.changeSelection(stateChartNode);
          return;
        }
        index++;
      }
    }
  }
  changeSelection(stateChartNode: StateChartNode) {
    if (this.selected) {
      // unselect previous state
      this.selected.setState({ selected: false });
    }
    // set the current selected state
    stateChartNode.setState({ selected: true });
    this.selected = stateChartNode;
  }
  onSelectionChange(stateChartNode: StateChartNode) {
    this.changeSelection(stateChartNode);
    // notify a start chart was selected
    if (this.props.onSelectionChange) {
      this.props.onSelectionChange(stateChartNode);
    }
  }
  onEvent(stateChartNodeEvent: StateChartNodeEvent) {
    if (this.props.onEvent) {
      this.props.onEvent(stateChartNodeEvent);
    }
  }
  isEdgeSelected(edge: XStateEdge<any, any, any>): boolean {
    for (const stateChartNode of this.state.history) {
      const event = edge.event && edge.event.type ? edge.event.type : edge.event;
      if (edge.source.id === stateChartNode.props.stateNode.id && 
        stateChartNode.state.selectedEvents.includes(event)) {
          return true;
      }
    }
    return false;
  }
  render() {
    const { current, preview, previewEvent, machine, code, hideRootHeader } = this.state;

    const edges = getEdges(machine);

    const stateNodes = machine.getStateNodes(current);
    const events = new Set();

    stateNodes.forEach(stateNode => {
      const potentialEvents = Object.keys(stateNode.on);

      potentialEvents.forEach(event => {
        const transitions = stateNode.on[event];

        transitions.forEach(transition => {
          if (transition.target !== undefined) {
            events.add(event);
          }
        });
      });
    });
    return (
      <StyledStateChart
        className={[this.props.className, this.state.view].join(' ')}
        key={code}
        style={{
          height: this.props.height || '100%',
          background: 'var(--color-app-background)',
          // @ts-ignore
          '--color-app-background': '#FFF',
          '--color-border': '#dedede',
          '--color-border-selected': '#999',
          '--color-primary': 'rgba(87, 176, 234, 1)',
          '--color-primary-faded': 'rgba(87, 176, 234, 0.5)',
          '--color-primary-shadow': 'rgba(87, 176, 234, 0.1)',
          '--color-primary-selected': 'rgba(87, 176, 234, 0.2)',
          '--color-link': 'rgba(87, 176, 234, 1)',
          '--color-disabled': '#c7c5c5',
          '--color-edge': 'rgba(0, 0, 0, 0.2)',
          '--color-secondary': 'rgba(255,152,0,1)',
          '--color-secondary-light': 'rgba(255,152,0,.5)',
          '--color-sidebar': '#272722',
          '--radius': '0.2rem',
          '--border-width': '2px'
        }}
      >
        <StyledVisualization>
          <StateChartNode
            stateChart={this}
            stateNode={machine}
            current={current}
            preview={preview}
            hideRootHeader={hideRootHeader}
            onReset={this.reset.bind(this)}
            onSelectionChange={this.onSelectionChange.bind(this)}
            onEvent={stateChartNodeEvent => {
              this.state.service.send(stateChartNodeEvent.event);
              this.onEvent(stateChartNodeEvent);
            }}
            onPreEvent={event =>
              this.setState({
                preview: this.state.service.nextState(event),
                previewEvent: event
              })
            }
            onExitPreEvent={() =>
              this.setState({ preview: undefined, previewEvent: undefined })
            }
            toggledStates={this.state.toggledStates}
          />
          <svg
            width="100%"
            height="100%"
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              // @ts-ignore
              '--color': 'gray',
              overflow: 'visible',
              pointerEvents: 'none'
            }}
            ref={this.svgRef}
            key={JSON.stringify(this.state.toggledStates)}
          >
            <defs>
              <marker
                id="marker"
                markerWidth="4"
                markerHeight="4"
                refX="2"
                refY="2"
                markerUnits="strokeWidth"
                orient="auto"
              >
                <path d="M0,0 L0,4 L4,2 z" fill="var(--color-edge)" />
              </marker>
              <marker
                id="marker-preview"
                markerWidth="4"
                markerHeight="4"
                refX="2"
                refY="2"
                markerUnits="strokeWidth"
                orient="auto"
              >
                <path d="M0,0 L0,4 L4,2 z" fill="gray" />
              </marker>
              <marker
                id="marker-selected"
                markerWidth="4"
                markerHeight="4"
                refX="2"
                refY="2"
                markerUnits="strokeWidth"
                orient="auto"
              >
                <path d="M0,0 L0,4 L4,2 z" fill="black" />
              </marker>
            </defs>
            {edges.map(edge => {
              if (!this.svgRef.current) {
                return;
              }

              // const svgRect = this.svgRef.current.getBoundingClientRect();

              return (
                <Edge
                  key={serializeEdge(edge)}
                  svg={this.svgRef.current}
                  edge={edge}
                  selected={this.isEdgeSelected(edge)}
                  preview={
                    edge.event === previewEvent &&
                    current.matches(edge.source.path.join('.')) &&
                    !!preview &&
                    preview.matches(edge.target.path.join('.'))
                  }
                />
              );
            })}
            {initialStateNodes(machine).map((initialStateNode, i) => {
              if (!this.svgRef.current) {
                return;
              }

              // const svgRect = this.svgRef.current.getBoundingClientRect();

              return (
                <InitialEdge
                  key={`${initialStateNode.id}_${i}`}
                  source={initialStateNode}
                  svgRef={this.svgRef.current}
                  preview={
                    current.matches(initialStateNode.path.join('.')) ||
                    (!!preview &&
                      preview.matches(initialStateNode.path.join('.')))
                  }
                />
              );
            })}
          </svg>
        </StyledVisualization>
        {this.state.view !== StateChartViewType.ChartOnly && 
          <StyledSidebar>
            <StyledViewTabs>
              {[StateChartViewType.Definition, StateChartViewType.State].map(view => {
                return (
                  <StyledViewTab
                    onClick={() => this.setState({ view })}
                    key={view}
                    data-active={this.state.view === view || undefined}
                  >
                    {view}
                  </StyledViewTab>
                );
              })}
            </StyledViewTabs>
            <StyledView>{this.renderView()}</StyledView>
          </StyledSidebar>
        } 
      </StyledStateChart>
    );
  }
}
