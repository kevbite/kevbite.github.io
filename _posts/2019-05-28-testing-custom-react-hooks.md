---
layout: post
title: Testing custom React Hooks
categories:
tags: [React, JavaScript, Testing, Hooks, TypeScript, Jest, Enzyme]
description: How to test custom React Hooks using Jest and Enzyme
comments: true
---

[React Hooks](https://reactjs.org/docs/hooks-intro.html) were introduced in [React 16.8](https://www.npmjs.com/package/react/v/16.8.0) which was released in [February 2019](https://www.npmjs.com/package/react/v/16.8.0). These simplify your components and allow you to reusable state and behavior between multiple components without the overhead complexity.

However, being good software engineers we want to gain confident in our code by writing tests, this article will provide common testing strategies for testing React Hooks.

## Testing components with hooks

So let's start off with a simple component (`counter.tsx`) that uses the [`useState`](https://reactjs.org/docs/hooks-state.html) Hook. This simple component has a button to increment a value, we also have a `<div>` that will be displaying the current state value. It also has some basic logic whereby when the value gets to 5 it won't be able to increment anymore.

```jsx
import React, { useState } from 'react';

export default () => {
  const [value, setValue] = useState(0);

  const increment = () => {
    if (value >= 5) {
      return;
    }
    setValue(value + 1);
  };

  return (
    <div>
      <div className='value'>{value}</div>
      <button className='increment-btn' onClick={increment}>+1</button>
    </div>
  )
};

```

So let's see what the tests could look like for this.

We will start by creating a basic test to check that `"0"` is rendered in our `<div>` with the `className="value"`, we will use [enzyme](https://airbnb.io/enzyme/) to [shallow render](https://airbnb.io/enzyme/docs/api/shallow.html) the component.

```typescript
import React from 'react';
import { shallow } from 'enzyme';
import Counter from './counter';

it('renders with initial value of 0', () => {
  const wrapper = shallow(<Counter />);

  expect(wrapper.find(".value").text()).toEqual("0");
});
```

Our next test will check that our value increments when the `+1` button is clicked, this is very similar but we'll use the [simulate](https://airbnb.io/enzyme/docs/api/ShallowWrapper/simulate.html) function to simulate events on the button.

```typescript
it('increments value when clicking +1', () => {
  const wrapper = shallow(<Counter />);

  wrapper.find('.increment-btn').simulate('click')
  expect(wrapper.find(".value").text()).toEqual("1");
});
```

Now we've got that passing we'll make sure that the component does not go over the value of 5 after it's clicked 6 times.

```typescript
it('does not increments value over 5', () => {
  const wrapper = shallow(<Counter />);

  const increment = () => wrapper.find('.increment-btn').simulate('click');

  Array(6).fill(null).forEach(increment);

  expect(wrapper.find(".value").text()).toEqual("5");
});
```

As you can see we're not having to do anything different while testing the component compared to a normal [class based component](https://reactjs.org/docs/components-and-props.html#function-and-class-components). We can actually swap out the current implementation (`counter.tsx`) for the following class and all our tests will continue to pass as the expose functionality is the same.

```jsx
export default class Counter extends React.Component<{}, { value: number }> {
  constructor(props: {}) {
    super(props);
    this.state = {
      value: 0
    };
  }


  increment = () => {
    if (this.state.value >= 5) {
      return;
    }
    this.setState({ value: this.state.value + 1 });
  };

  decrement = () => {
    if (this.state.value <= 0) {
      return;
    }
    this.setState({ value: this.state.value - 1 });
  };

  render() {
    return (
      <div>
        <div className="value">{this.state.value}</div>
        <button className="increment-btn" onClick={this.increment}>+1</button>
        <button className="decrement-btn" onClick={this.decrement}>-1</button>
      </div>
    );
  }
}
```

## Testing components with custom hooks

One of the great things about React Hooks is the ability to abstract away functionality in to custom Hooks and reuse them with multiple components. We'll pull out our current functionality for our counter in to a `useCounter` custom Hook (`counter-hook.tsx`).

```jsx
import React, { useState } from 'react';

export const useCounter = () => {
  const [value, setValue] = useState(0);

  const increment = () => {
    if (value >= 5) {
      return;
    }
    setValue(value + 1);
  };

  return {
    value,
    increment
  }
};
```

We can then update out function based component consume our custom hook.

```jsx
import React from 'react';
import { useCounter } from './counter-hook';

export default () => {
  const {
    value,
    increment
  } = useCounter();

  return (
    <div>
      <div className="value">{value}</div>
      <button className="increment-btn" onClick={increment}>+1</button>
    </div>
  )
};
```

You'll also be able to re-run the tests and everything should be still passing.

```bash
 PASS  src/counter.spec.tsx
  √ renders with initial value of 0 (11ms)
  √ increments value when clicking +1 (2ms)
  √ does not increments value over 5 (5ms)

Test Suites: 1 passed, 1 total
Tests:       3 passed, 3 total
Snapshots:   0 total
Time:        3.843s
Ran all test suites related to changed files.
```

### Reusing custom Hooks?

What if we are re-using our custom hook, do we really want to test every component end to end? We might want to create more detailed tests around our custom Hooks and test the custom Hook boundaries. So we would think the follow would be possible.

```typescript
import { useCounter } from './counter-hook';

it('renders with initial value of 0', () => {
  const counter = useCounter();

  expect(counter.value).toEqual(0);
});

```

However, if we run the above test we get `Invariant Violation: Invalid hook call. Hooks can only be called inside of the body of a function component.` Error. This is because our hook is not being used within a React function component. We could however create a wrapper test component which the hook could be created in but there is already a npm package out there to do all the heavy lifting for us. This package is called [`react-hooks-testing-library`](https://www.npmjs.com/package/react-hooks-testing-library).

With this package installed we can alter our above test to use the `renderHook` function to create our custom Hook within a component wrapper.

```typescript
import { useCounter } from './counter-hook';
import { renderHook } from 'react-hooks-testing-library'

it('Should have initial value of 0', () => {
  const { result: { current } } = renderHook(() => useCounter());

  expect(current.value).toEqual(0);
});
```

Now we're using state that our custom Hook exposes we will need to also call methods exposed by our custom hook, for this the library gives us another function called `act` in which we can pass in a callback to execute on the render hook.

We can now implement our `Should increment value` test with the react hooks testing library.

```typescript
it('Should increment value', () => {
  const { result } = renderHook(() => useCounter());

  act(() => result.current.increment());

  expect(result.current.value).toEqual(1);
});
```

Then our last test is just as easy.

```typescript
it('Does not increment value over 5', () => {
  const { result } = renderHook(() => useCounter());

  const increment = () => act(() => result.current.increment());

  Array(6).fill(null).forEach(increment);

  expect(result.current.value).toEqual(5);
});
```

### Mocking custom Hook

Now we are testing our custom Hook in isolation it might worth mocking our custom Hook so we can control our component behavior, we'll just the standard [jest modules mocking](https://jestjs.io/docs/en/mock-functions#mocking-modules), this will allow us to return any values we like back from the `useCounter` call on our custom Hook.

```jsx
import React from 'react';
import { shallow } from 'enzyme';
import Counter from './counter';
import * as CounterHook from './counter-hook';

jest.mock('./counter-hook');

it('renders with value from counter hook', () => {
  const mockedCounterHook = CounterHook as jest.Mocked<typeof CounterHook>;
  mockedCounterHook.useCounter.mockImplementation(() => {
    return {
      value: 50,
      increment: () => { }
    }
  });

  const wrapper = shallow(<Counter />);

  expect(wrapper.find(".value").text()).toEqual("50");
});
```

As you'll see we are just passing a value of `50` back now and expecting `"50"` to be rendered in our component.

We can do the same for pressing the `+1` button, we don't really care about the logic behind the `useCounter` Hook anymore, only that when we click the button it calls the `increment` method and delegated the work on from our component, for this we can use the [jest mock functions](https://jestjs.io/docs/en/mock-functions#mock-return-values) (`jest.fn()`).

```jsx
it('Calls counter increment when clicking +1', () => {
  const incrementMock = jest.fn();
  const mockedCounterHook = CounterHook as jest.Mocked<typeof CounterHook>;
  mockedCounterHook.useCounter.mockImplementation(() => {
    return {
      value: 0,
      increment: incrementMock
    }
  });
  const wrapper = shallow(<Counter />);

  wrapper.find('.increment-btn').simulate('click')
  expect(incrementMock).toBeCalled();
});
```

## Testing custom hooks that use a context object

So imagine we want to use our custom scoped across multiple component, this is where context objects become useful. We can change around the implementation of our counter Hook to be the following:

```jsx
import React, {
  useState,
  createContext,
  useContext,
} from 'react';

const Context = createContext<[number, React.Dispatch<React.SetStateAction<number>>] | undefined>(undefined);

export const CounterProvider: React.FC = ({ children }) => {
  const [value, setValue] = useState(0);
  return (
    <Context.Provider value={[value, setValue]}>
      {children}
    </Context.Provider>
  );
};

export const useCounter = () => {
  const context = useContext(Context);

  if (!context) {
    throw new Error("useCounter must be used within a CounterProvider");
  }

  const [value, setValue] = context;

  const increment = () => {
    if (value >= 5) {
      return;
    }
    setValue(value + 1);
  };

  return {
    value,
    increment
  }
};
```

However now our test will throw a `useCounter must be used within a CounterProvider` exception. This is because the Hook now needs to be within a `CounterProvider` component. Lucky enough the second argument to the `renderHook` function has an option that allows the hook to be wrapped in a given component. We can use this to specify our `CounterProvider` above.

```jsx
import React from 'react';
import { useCounter, CounterProvider } from './counter-hook';
import { renderHook, act } from 'react-hooks-testing-library'

it('renders with initial value of 0', () => {
  const { result: { current } } = renderHook(() => useCounter(), { wrapper: CounterProvider });

  expect(current.value).toEqual(0);
});

it('Should increment value', () => {
  const { result } = renderHook(() => useCounter(), { wrapper: CounterProvider });

  act(() => result.current.increment());

  expect(result.current.value).toEqual(1);
});

it('Does not increment value over 5', () => {
  const { result } = renderHook(() => useCounter(), { wrapper: CounterProvider });

  const increment = () => act(() => result.current.increment());

  Array(6).fill(null).forEach(increment);

  expect(result.current.value).toEqual(5);
});
```

Now this allows us to share the custom Hooks state within a given context.