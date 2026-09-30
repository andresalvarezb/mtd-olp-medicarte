'use client';

import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';


export function useLoadingFeedback(
  actualLoading:
    boolean,

  minimumMs =
    700,
) {
  const [
    manualActive,
    setManualActive,
  ] =
    useState(
      false,
    );

  const timer =
    useRef<
      number |
      null
    >(
      null,
    );


  const trigger =
    useCallback(
      () => {
        if (
          timer.current !==
          null
        ) {
          window.clearTimeout(
            timer.current,
          );
        }

        setManualActive(
          true,
        );

        timer.current =
          window.setTimeout(
            () => {
              setManualActive(
                false,
              );

              timer.current =
                null;
            },
            minimumMs,
          );
      },
      [
        minimumMs,
      ],
    );


  useEffect(
    () => {
      return () => {
        if (
          timer.current !==
          null
        ) {
          window.clearTimeout(
            timer.current,
          );
        }
      };
    },
    [],
  );


  return {
    visible:
      actualLoading ||
      manualActive,

    trigger,
  };
}
