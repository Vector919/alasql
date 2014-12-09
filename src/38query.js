// Main query procedure
function queryfn(query,oldscope,cb, A,B) {
	var ms;
		query.sourceslen = query.sources.length;
		var slen = query.sourceslen;
		query.A = A;
		query.B = B;
//	console.log(arguments);
		query.cb = cb;

	// Run all subqueries before main statement
	if(query.queriesfn) {
		query.sourceslen += query.queriesfn.length;
		slen += query.queriesfn.length;

		query.queriesdata = [];

//		console.log(8);
		query.queriesfn.forEach(function(q,idx){
//			if(query.explain) ms = Date.now();
//console.log(18,idx);
//			var res = flatArray(q(query.params,null,queryfn2,(-idx-1),query));

//			var res = flatArray(queryfn(q.query,null,queryfn2,(-idx-1),query));

			queryfn(q.query,null,queryfn2,(-idx-1),query);


//			query.explaination.push({explid: query.explid++, description:'Query '+idx,ms:Date.now()-ms});
//			query.queriesdata[idx] = res;
//			return res;
		});
//		console.log(9,query.queriesdata.length);
//		console.log(query.queriesdata[0]);
	}

	var scope;
	if(!oldscope) scope = {};
	else scope = cloneDeep(oldscope);
	query.scope = scope;

	// First - refresh data sources

	var result;
	query.sources.forEach(function(source, idx){
//		source.data = query.database.tables[source.tableid].data;
//		console.log(666,idx);
		source.query = query;
		var rs = source.datafn(query, query.params, queryfn2, idx); 
//		console.log(333,rs);
		if(typeof rs != undefined) result = rs;
//		console.log(444,result);
//
// Ugly hack to use in query.wherefn and source.srcwherefns functions
// constructions like this.queriesdata['test'].
// I can elimite it with source.srcwherefn.bind(this)()
// but it may be slow.
// 
		source.queriesdata = query.queriesdata;  
	});
	if(slen == 0) result = queryfn3(query);
	return result;
};

function queryfn2(data,idx,query) {

//console.log(56,arguments);
		console.log(78,idx,data);
console.trace();

	if(idx>=0) {
		var source = query.sources[idx];
		source.data = data;
		if(typeof source.data == 'function') {
			source.getfn = source.data;
			source.dontcache = source.getfn.dontcache;

	//			var prevsource = query.sources[h-1];
			if(source.joinmode == 'OUTER' || source.joinmode == 'RIGHT' || source.joinmode == 'ANTI') {
				source.dontcache = false;
			}
			source.data = {};
		}
	} else {
		// subqueries
		query.queriesdata[-idx-1] = flatArray(data);
//		console.log(79,query.queriesdata);
	}

	query.sourceslen--;
	if(query.sourceslen>0) return;

	return queryfn3(query);
};

function queryfn3(query) {
//console.log(55,query);


	var scope = query.scope;
	// Preindexation of data sources
//	if(!oldscope) {
		preIndex(query);
//	}

	// query.sources.forEach(function(source) {
	// 		console.log(source.data);
	// });

	// Prepare variables
	query.data = [];
	query.xgroups = {};
	query.groups = [];

	// Level of Joins
	var h = 0;

	// Start walking over data
	doJoin(query, scope, h);

//console.log(85,query.data[0]);

	// If groupping, then filter groups with HAVING function
	if(query.groupfn) {
		if(query.havingfn) query.groups = query.groups.filter(query.havingfn)
		query.data = query.groups;
	};

	// Remove distinct values	
	doDistinct(query);	

	// Reduce to limit and offset
	doLimit(query);

	// UNION / UNION ALL
	if(query.unionallfn) {
		query.data = query.data.concat(query.unionallfn(query.params));
	} else if(query.unionfn) {
		query.data = arrayUnionDeep(query.data, query.unionfn(query.params));
	} else if(query.exceptfn) {
		query.data = arrayExceptDeep(query.data, query.exceptfn(query.params));
	} else if(query.intersectfn) {
		query.data = arrayIntersectDeep(query.data, query.intersectfn(query.params));
	};

	// Ordering
	if(query.orderfn) {
		if(query.explain) var ms = Date.now();
		query.data = query.data.sort(query.orderfn);
		if(query.explain) { 
			query.explaination.push({explid: query.explid++, description:'QUERY BY',ms:Date.now()-ms});
		}
	};

//	console.log(query.intoallfns);

	if(query.explain) {
		if(query.cb) query.cb(query.explaination,query.A, query.B);
		return query.explaination;
	} else if(query.intoallfn) {
		return query.intoallfn(query.cb);	
	} else if(query.intofn) {
		for(var i=0,ilen=query.data.length;i<ilen;i++){
			query.intofn(query.data[i],i);
		}
//		console.log(query.intofn);
		if(query.cb) query.cb(query.data.length,query.A, query.B);
		return query.data.length;
	} else {
//		console.log(111,query.cb,query.data);
		var res = query.data;
		if(query.cb) res = query.cb(query.data,query.A, query.B);
//		console.log(777,res)
		return res;
	}

	// That's all
};

// Limiting
function doLimit (query) {
//	console.log(query.limit, query.offset)
	if(query.limit) {
		var offset = 0;
		if(query.offset) offset = ((query.offset|0)-1)||0;
		var limit = (query.limit|0) + offset;
		query.data = query.data.slice(offset,limit);
	}
}

// Distinct
function doDistinct (query) {
	if(query.distinct) {
		var uniq = {};
		// TODO: Speedup, because Object.keys is slow
		for(var i=0,ilen=query.data.length;i<ilen;i++) {
			var uix = Object.keys(query.data[i]).map(function(k){return query.data[i][k]}).join('`');
			uniq[uix] = query.data[i];
		};
		query.data = [];
		for(var key in uniq) query.data.push(uniq[key]);
	}
};


// Optimization: preliminary indexation of joins
preIndex = function(query) {
//	console.log(query);
	// Loop over all sources
	for(var k=0, klen = query.sources.length;k<klen;k++) {
		var source = query.sources[k];
		// If there is indexation rule
//console.log('preIndex', source);

		if(k > 0 && source.optimization == 'ix' && source.onleftfn && source.onrightfn) {
			// If there is no table.indices - create it
			if(query.database.tables[source.tableid]) {
				if(!query.database.tables[source.tableid].indices) query.database.tables[source.tableid].indices = {};
					// Check if index already exists
				var ixx = query.database.tables[source.tableid].indices[hash(source.onrightfns+'`'+source.srcwherefns)];
				if( !query.database.tables[source.tableid].dirty && ixx) {
					source.ix = ixx; 
				}
			};

			if(!source.ix) {
				source.ix = {};
				// Walking over source data
				var scope = {};
				var i = 0;
				var ilen = source.data.length;
				var dataw;
//				while(source.getfn i<ilen) {

				while((dataw = source.data[i]) || (source.getfn && (dataw = source.getfn(i))) || (i<ilen)) {
					if(source.getfn && !source.dontcache) source.data[i] = dataw;
//					scope[tableid] = dataw;

//				for(var i=0, ilen=source.data.length; i<ilen; i++) {
					// Prepare scope for indexation
					scope[source.alias || source.tableid] = dataw;

					// Check if it apply to where function 
					if(source.srcwherefn(scope, query.params, alasql)) {
						// Create index entry for each address
						var addr = source.onrightfn(scope, query.params, alasql);
						var group = source.ix [addr]; 
						if(!group) {
							group = source.ix [addr] = []; 
						}
						group.push(dataw);
					}
					i++;
				}
				if(query.database.tables[source.tableid]){
					// Save index to original table				
					query.database.tables[source.tableid].indices[hash(source.onrightfns+'`'+source.srcwherefns)] = source.ix;
				};
			}
			// Optimization for WHERE column = expression
		} else if (source.wxleftfns) {
			// Check if index exists
			var ixx = query.database.tables[source.tableid].indices[hash(source.wxleftfns+'`')];
			if( !query.database.tables[source.tableid].dirty && ixx) {
				// Use old index if exists
				source.ix = ixx;
				// Reduce data (apply filter)
				source.data = source.ix[source.wxrightfn(null, query.params, alasql)]; 
			} else {
				// Create new index
				source.ix = {};
				// Prepare scope
				var scope = {};
				// Walking on each source line
				var i = 0;
				var ilen = source.data.length;
				var dataw;
//				while(source.getfn i<ilen) {

				while((dataw = source.data[i]) || (source.getfn && (dataw = source.getfn(i))) || (i<ilen)) {
					if(source.getfn && !source.dontcache) source.data[i] = dataw;
//				for(var i=0, ilen=source.data.length; i<ilen; i++) {
					scope[source.alias || source.tableid] = source.data[i];
					// Create index entry
					var addr = source.wxleftfn(scope, query.params, alasql);
					var group = source.ix [addr]; 
					if(!group) {
						group = source.ix [addr] = []; 
					}
					group.push(source.data[i]);
					i++;
				}
//					query.database.tables[source.tableid].indices[hash(source.wxleftfns+'`'+source.onwherefns)] = source.ix;
				query.database.tables[source.tableid].indices[hash(source.wxleftfns+'`')] = source.ix;
			}
			// Apply where filter to reduces rows
			if(source.srcwherefns) {
				if(source.data) {
					var scope = {};
					source.data = source.data.filter(function(r) {
						scope[source.alias] = r;
						return source.srcwherefn(scope, query.params, alasql);
					});
				} else {
					source.data = [];
				}
			}		

		// If there is no any optimization than apply srcwhere filter
		} else if(source.srcwherefns && !source.dontcache) {
			if(source.data) {
				var scope = {};
				// TODO!!!!! Data as Function

				source.data = source.data.filter(function(r) {
					scope[source.alias] = r;
//					console.log(288,source);
					return source.srcwherefn(scope, query.params, alasql);
				});

				var scope = {};
				var i = 0;
				var ilen = source.data.length;
				var dataw;
				var res = [];
//				while(source.getfn i<ilen) {

				while((dataw = source.data[i]) || (source.getfn && (dataw = source.getfn(i))) || (i<ilen)) {
					if(source.getfn && !source.dontcache) source.data[i] = dataw;
					scope[source.alias] = dataw;
					if(source.srcwherefn(scope, query.params, alasql)) res.push(dataw);
					i++;
				}
				source.data = res;

			} else {
				source.data = [];
			};
		}			
		// Change this to another place (this is a wrong)
		if(query.database.tables[source.tableid]) {
			//query.database.tables[source.tableid].dirty = false;
		} else {
			// this is a subquery?
		}
	}
}

