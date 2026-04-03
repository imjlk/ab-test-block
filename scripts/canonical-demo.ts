type VariantKey = 'a' | 'b';

type CanonicalVariantDefinition = {
	body: string;
	ctaHref: string;
	ctaLabel: string;
	heading: string;
	label: string;
};

type CanonicalExperimentAttributes = {
	blockInstanceId: string;
	emitBrowserEvents?: boolean;
	emitClarityHook?: boolean;
	emitDataLayer?: boolean;
	emitKexpLayer?: boolean;
	evaluationWindowDays?: number;
	experimentId: string;
	experimentLabel: string;
	lockWinnerAfterSelection?: boolean;
	minimumClicksPerVariant?: number;
	minimumImpressionsPerVariant?: number;
	previewQueryKey: string;
	stickyAssignment?: boolean;
	stickyScope?: 'experiment' | 'instance';
	trackClicks?: boolean;
	trackImpressions?: boolean;
	variantCount?: 2;
	winnerMode?: 'automatic' | 'manual' | 'off';
};

const DEFAULT_ATTRIBUTES = {
	emitBrowserEvents: true,
	emitClarityHook: false,
	emitDataLayer: false,
	emitKexpLayer: false,
	evaluationWindowDays: 14,
	lockWinnerAfterSelection: true,
	minimumClicksPerVariant: 1,
	minimumImpressionsPerVariant: 100,
	stickyAssignment: true,
	stickyScope: 'instance',
	trackClicks: true,
	trackImpressions: true,
	variantCount: 2,
	winnerMode: 'off',
} as const;

const CANONICAL_VARIANTS: Record< VariantKey, CanonicalVariantDefinition > = {
	a: {
		body: 'Use this canonical fixture to validate editor and front-end parity around shell styling, spacing, and CTA rhythm.',
		ctaHref: '#variant-a',
		ctaLabel: 'Explore Variant A',
		heading: 'Variant A: Free shipping framing',
		label: 'Variant A',
	},
	b: {
		body: 'This alternate variant keeps the same structure while changing the copy so the two active states stay visually comparable.',
		ctaHref: '#variant-b',
		ctaLabel: 'Explore Variant B',
		heading: 'Variant B: Limited-time framing',
		label: 'Variant B',
	},
};

function buildHeadingMarkup( text: string ) {
	return `<!-- wp:heading {"level":3} --><h3 class="wp-block-heading">${ text }</h3><!-- /wp:heading -->`;
}

function buildParagraphMarkup( text: string ) {
	return `<!-- wp:paragraph --><p>${ text }</p><!-- /wp:paragraph -->`;
}

function buildButtonsMarkup( href: string, label: string ) {
	return `<!-- wp:buttons --><div class="wp-block-buttons"><!-- wp:button {"url":"${ href }","className":"abtest-cta"} --><div class="wp-block-button abtest-cta"><a class="wp-block-button__link wp-element-button" href="${ href }">${ label }</a></div><!-- /wp:button --></div><!-- /wp:buttons -->`;
}

function buildVariantMarkup( variantKey: VariantKey ) {
	const variant = CANONICAL_VARIANTS[ variantKey ];

	return `<!-- wp:abtest-block/variant ${ JSON.stringify( {
		variantKey,
		variantLabel: variant.label,
	} ) } --><div class="wp-block-abtest-block-variant" data-abtest-variant="${ variantKey }" data-variant-label="${
		variant.label
	}">${ buildHeadingMarkup( variant.heading ) }${ buildParagraphMarkup(
		variant.body
	) }${ buildButtonsMarkup(
		variant.ctaHref,
		variant.ctaLabel
	) }</div><!-- /wp:abtest-block/variant -->`;
}

export function buildCanonicalExperimentMarkup(
	attributes: CanonicalExperimentAttributes
) {
	return `<!-- wp:abtest-block/test ${ JSON.stringify( {
		...DEFAULT_ATTRIBUTES,
		...attributes,
		automaticMetric: 'ctr',
		weights: {
			a: 50,
			b: 50,
		},
	} ) } -->${ buildVariantMarkup( 'a' ) }${ buildVariantMarkup(
		'b'
	) }<!-- /wp:abtest-block/test -->`;
}

export function getCanonicalExperimentExample() {
	return {
		attributes: {
			automaticMetric: 'ctr',
			blockInstanceId: 'visualfixture1',
			emitBrowserEvents: true,
			emitClarityHook: false,
			emitDataLayer: false,
			emitKexpLayer: false,
			evaluationWindowDays: 14,
			experimentId: 'visual_fixture',
			experimentLabel: 'Visual parity fixture',
			lockWinnerAfterSelection: true,
			minimumClicksPerVariant: 1,
			minimumImpressionsPerVariant: 100,
			previewQueryKey: 'ab_visual_fixture',
			stickyAssignment: true,
			stickyScope: 'instance',
			trackClicks: true,
			trackImpressions: true,
			variantCount: 2,
			weights: {
				a: 50,
				b: 50,
				c: 0,
			},
			winnerMode: 'off',
		},
		innerBlocks: ( [ 'a', 'b' ] as const ).map( ( variantKey ) => {
			const variant = CANONICAL_VARIANTS[ variantKey ];

			return {
				attributes: {
					variantKey,
					variantLabel: variant.label,
				},
				innerBlocks: [
					{
						attributes: {
							content: variant.heading,
							level: 3,
						},
						name: 'core/heading',
					},
					{
						attributes: {
							content: variant.body,
						},
						name: 'core/paragraph',
					},
					{
						innerBlocks: [
							{
								attributes: {
									className: 'abtest-cta',
									text: variant.ctaLabel,
									url: variant.ctaHref,
								},
								name: 'core/button',
							},
						],
						name: 'core/buttons',
					},
				],
				name: 'abtest-block/variant',
			};
		} ),
		viewportWidth: 960,
	};
}

export function getCanonicalVariantExample( variantKey: VariantKey = 'a' ) {
	const variant = CANONICAL_VARIANTS[ variantKey ];

	return {
		attributes: {
			variantKey,
			variantLabel: variant.label,
		},
		innerBlocks: [
			{
				attributes: {
					content: variant.heading,
					level: 3,
				},
				name: 'core/heading',
			},
			{
				attributes: {
					content: variant.body,
				},
				name: 'core/paragraph',
			},
			{
				innerBlocks: [
					{
						attributes: {
							className: 'abtest-cta',
							text: variant.ctaLabel,
							url: variant.ctaHref,
						},
						name: 'core/button',
					},
				],
				name: 'core/buttons',
			},
		],
	};
}
