import { tags } from 'typia';

export interface AbTestBlockCounterQuery {
	postId: number & tags.Type< 'uint32' >;
	resourceKey: string & tags.MinLength< 1 > & tags.MaxLength< 100 >;
}

export interface AbTestBlockIncrementRequest {
	postId: number & tags.Type< 'uint32' >;
	publicWriteToken?: string & tags.MinLength< 1 > & tags.MaxLength< 512 >;
	resourceKey: string & tags.MinLength< 1 > & tags.MaxLength< 100 >;
	delta?: number & tags.Minimum< 1 > & tags.Type< 'uint32' > & tags.Default< 1 >;
}

export interface AbTestBlockCounterResponse {
	postId: number & tags.Type< 'uint32' >;
	resourceKey: string & tags.MinLength< 1 > & tags.MaxLength< 100 >;
	count: number & tags.Minimum< 0 > & tags.Type< 'uint32' >;
	storage: ( 'post-meta' | 'custom-table' );
}
