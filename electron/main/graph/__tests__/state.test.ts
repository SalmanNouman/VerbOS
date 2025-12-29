import { describe, it, expect } from 'vitest';
import { StateGraph, START, END } from '@langchain/langgraph';
import { GraphState, iterationCountReducer } from '../state';
import { HumanMessage, AIMessage } from '@langchain/core/messages';

describe('GraphState and Reducers', () => {
  describe('iterationCountReducer', () => {
    it('should increment by 1 when next is null or undefined', () => {
      expect(iterationCountReducer(0, undefined)).toBe(1);
      expect(iterationCountReducer(5, null)).toBe(6);
    });

    it('should set to specific value when provided', () => {
      expect(iterationCountReducer(0, 10)).toBe(10);
      expect(iterationCountReducer(5, 0)).toBe(0);
    });
  });

  describe('GraphState Integration', () => {
    it('should initialize with correct defaults and manage messages', async () => {
      const node = () => {
        return {
          messages: [new AIMessage('processed')],
        };
      };

      const workflow = new StateGraph(GraphState)
        .addNode('test_node', node)
        .addEdge(START, 'test_node')
        .addEdge('test_node', END);

      const app = workflow.compile();
      
      const initialState = {
        messages: [new HumanMessage('start')]
      };
      
      const result = await app.invoke(initialState);
      
      expect(result.messages).toHaveLength(2);
      expect(result.messages[0].content).toBe('start');
      expect(result.messages[1].content).toBe('processed');
    });

    it('should increment iterationCount when explicitly triggered', async () => {
      const node = () => {
        return {
          iterationCount: undefined // Triggers the (current, next) => next ?? current + 1 logic
        } as any;
      };

      const workflow = new StateGraph(GraphState)
        .addNode('test_node', node)
        .addEdge(START, 'test_node')
        .addEdge('test_node', END);

      const app = workflow.compile();
      const result = await app.invoke({});
      expect(result.iterationCount).toBe(1);
    });

    it('should allow explicitly setting iterationCount', async () => {
      const node = () => {
        return {
          iterationCount: 99
        };
      };

      const workflow = new StateGraph(GraphState)
        .addNode('test_node', node)
        .addEdge(START, 'test_node')
        .addEdge('test_node', END);

      const app = workflow.compile();
      const result = await app.invoke({});
      expect(result.iterationCount).toBe(99);
    });
  });
});