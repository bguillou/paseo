export interface InlineImageDimensions {
  width: number;
  height: number;
}

export interface InlineImageExplicitDimensions {
  width?: number;
  height?: number;
}

const INLINE_IMAGE_MAX_WIDTH = 240;
const INLINE_IMAGE_MAX_HEIGHT = 160;

/** Smaller cap for cramped surfaces (e.g. PR comment bodies), rendered as a thumbnail. */
export const INLINE_IMAGE_PREVIEW_BOUNDS = { maxWidth: 120, maxHeight: 90 } as const;

export function resolveInlineImageSize(
  input: {
    explicit: InlineImageExplicitDimensions;
    natural: InlineImageDimensions | null;
  },
  bounds?: { maxWidth: number; maxHeight: number },
): InlineImageDimensions {
  const maxWidth = bounds?.maxWidth ?? INLINE_IMAGE_MAX_WIDTH;
  const maxHeight = bounds?.maxHeight ?? INLINE_IMAGE_MAX_HEIGHT;
  const dimensions = resolveInlineImageDimensions(input);
  const scale = Math.min(1, maxWidth / dimensions.width, maxHeight / dimensions.height);

  return {
    width: Math.round(dimensions.width * scale),
    height: Math.round(dimensions.height * scale),
  };
}

function resolveInlineImageDimensions(input: {
  explicit: InlineImageExplicitDimensions;
  natural: InlineImageDimensions | null;
}): InlineImageDimensions {
  if (input.explicit.width && input.explicit.height) {
    return { width: input.explicit.width, height: input.explicit.height };
  }

  if (input.explicit.width && input.natural) {
    return {
      width: input.explicit.width,
      height: input.explicit.width * (input.natural.height / input.natural.width),
    };
  }

  if (input.explicit.height && input.natural) {
    return {
      width: input.explicit.height * (input.natural.width / input.natural.height),
      height: input.explicit.height,
    };
  }

  if (input.explicit.width) {
    return { width: input.explicit.width, height: input.explicit.width };
  }

  if (input.explicit.height) {
    return { width: input.explicit.height, height: input.explicit.height };
  }

  return input.natural ?? { width: INLINE_IMAGE_MAX_WIDTH, height: INLINE_IMAGE_MAX_HEIGHT };
}
