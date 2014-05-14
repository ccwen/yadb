/*
	YADB version 3.0 GPL
	2013/2/14
	yapcheahshen@gmail.com
*/
var Yfs=require('./yadb3w_fs');
var DT=require('./yadb3').datatypes;
var Yfs_turbo=require('./yadb3w_turbofs');

var pack_int = function (ar, savedelta) { // pack ar into
  if (!ar || ar.length === 0) return []; // empty array
  var r = [],
  i = 0,
  j = 0,
  delta = 0,
  prev = 0;
  
  do {
	delta = ar[i];
	if (savedelta) {
		delta -= prev;
	}
	if (delta < 0) {
	  console.trace('negative',prev,ar[i],ar)
	  throw 'negetive';
	  break;
	}
	
	r[j++] = delta & 0x7f;
	delta >>= 7;
	while (delta > 0) {
	  r[j++] = (delta & 0x7f) | 0x80;
	  delta >>= 7;
	}
	prev = ar[i];
	i++;
  } while (i < ar.length);
  return r;
}
var Create=function(path,opts) {
	opts=opts||{};
	if (opts.bigfile) {
		console.log('big file, slower writing');
		var yfs=new Yfs(path,opts);
	} else {
		var yfs=new Yfs_turbo(path,opts);
	}
	var cur=0;
	
	//no signature
	var writeVInt =function(arr) {
		var o=pack_int(arr,false);
		yfs.writeFixedArray(o,cur,1);
		cur+=o.length;
	}
	var writeVInt1=function(value) {
		writeVInt([value]);
	}
	//for postings
	var writePInt =function(arr) {
		var o=pack_int(arr,true);
		yfs.writeFixedArray(o,cur,1);
		cur+=o.length;
	}
	
	var saveVInt = function(arr,key) {
		var start=cur;
		cur+=yfs.writeSignature(DT.vint,cur);
		writeVInt(arr);
		var written = cur-start;
		pushitem(key,written);
		return written;		
	}
	var savePInt = function(arr,key) {
		var start=cur;
		cur+=yfs.writeSignature(DT.pint,cur);
		writePInt(arr);
		var written = cur-start;
		pushitem(key,written);
		return written;	
	}

	
	var saveUI8 = function(value,key) {
		var written=yfs.writeUI8(value,cur);
		cur+=written;
		pushitem(key,written);
		return written;
	}
	var saveBool=function(value,key) {
		var written=yfs.writeBool(value,cur);
		cur+=written;
		pushitem(key,written);
		return written;
	}
	var saveI32 = function(value,key) {
		var written=yfs.writeI32(value,cur);
		cur+=written;
		pushitem(key,written);
		return written;
	}	
	var saveString = function(value,key,encoding) {
		encoding=encoding||stringencoding;
		var written=yfs.writeString(value,cur,encoding);
		cur+=written;
		pushitem(key,written);
		return written;
	}
	var saveStringArray = function(arr,key,encoding) {
		encoding=encoding||stringencoding;
		var written=yfs.writeStringArray(arr,cur,encoding);
		cur+=written;
		pushitem(key,written);
		return written;
	}
	
	var saveBlob = function(value,key) {
		var written=yfs.writeBlob(value,cur);
		cur+=written;
		pushitem(key,written);
		return written;
	}

	var folders=[];
	var pushitem=function(key,written) {
		var folder=folders[folders.length-1];	
		if (!folder) return ;
		folder.itemslength.push(written);
		if (key) {
			if (!folder.keys) throw 'cannot have key in array';
			folder.keys.push(key);
		}
	}	
	var open = function(opt) {
		var start=cur;
		var key=opt.key || null;
		var type=opt.type||DT.array;
		cur+=yfs.writeSignature(type,cur);
		cur+=yfs.writeOffset(0x0,cur); // pre-alloc space for offset
		var folder={
			type:type, key:key,
			start:start,datastart:cur,
			itemslength:[] };
		if (type===DT.object) folder.keys=[];
		folders.push(folder);
	}
	var openObject = function(key) {
		open({type:DT.object,key:key});
	}
	var openArray = function(key) {
		open({type:DT.array,key:key});
	}
	var saveInts=function(arr,key) {
		intarrfunc.apply(this,[arr,key]);
	}
	var close = function(opt) {
		if (!folders.length) throw 'empty stack';
		var folder=folders.pop();
		//jump to lengths and keys
		yfs.writeOffset( cur-folder.datastart, folder.datastart-5);
		var itemcount=folder.itemslength.length;
		//save lengths
		writeVInt1(itemcount);
		writeVInt(folder.itemslength);
		
		if (folder.type===DT.object) {
			//use utf8 for keys
			cur+=yfs.writeStringArray(folder.keys,cur,'utf8');
		}
		written=cur-folder.start;
		pushitem(folder.key,written);
		return written;
	}
	
	var intarrfunc=null;
	var integerEncoding=function(e) {
		intarrfunc=null;
		if (!e) return;
		if (e=='variable') intarrfunc=saveVInt;
		else if (e=='delta'||e=='posting') intarrfunc=savePInt;
	}

	var stringencoding='ucs2';
	var stringEncoding=function(newencoding) {
		if (newencoding) stringencoding=newencoding;
		else return stringencoding;
	}
	var allnumber_fast=function(arr) {
		if (typeof arr[0]=='number'
		    && Math.round(arr[0])==arr[0] && arr[0]>=0)
			return true;
		return false;
	}
	var sorted_ints=function(arr) {
		if (arr.length<2) return true;

		var checklen=arr.length;
		if (checklen>1000) { //only check first 1%
			checklen=Math.floor(arr.length/100);
		}
		for (var i=1;i<checklen;i++) {
			if (arr[i]<arr[i-1]) {
				return false;
			}
		}
		return true;
	}
	var allstring_fast=function(arr) {
		if (typeof arr[0]=='string') return true;
		return false;
	}	
	var allnumber=function(arr) {
		for (var i=0;i<arr.length;i++) {
			if (typeof arr[i]!=='number') return false;
		}
		return true;
	}
	var save=function(J,key,opts) {
		opts=opts||{};
		integerEncoding(opts.integerEncoding);
		
		if (typeof J=="null" || typeof J=="undefined") {
			throw 'cannot save null value of '+key+' folders'+JSON.stringify(folders);
			return;
		}
		var type=J.constructor.name;
		if (type==='Object') {
			openObject(key);
			for (var i in J) save(J[i],i,opts);
			close();
		} else if (type==='Array') {
			if (allnumber_fast(J) && intarrfunc ) {
				if (intarrfunc==saveVInt && sorted_ints(J)) {
					intarrfunc=savePInt;
					//console.log('using smaller format',key)
					saveInts(J,key);	//switch to delta format
					intarrfunc=saveVInt;
				} else {
					saveInts(J,key);	
				}
			} else if (allstring_fast(J)) {
				saveStringArray(J,key);
			} else {
				openArray(key);
				for (var i=0;i<J.length;i++) save(J[i],null,opts);
				close();
			}
		} else if (type==='String') {
			saveString(J,key);
		} else if (type==='Number') {
			if (J>=0&&J<256) saveUI8(J,key);
			else saveI32(J,key);
		} else if (type==='Boolean') {
			saveBool(J,key);
		} else if (type==='Buffer') {
			saveBlob(J,key);
		} else {
			throw 'unsupported type '+type;
		}
	}
	
	var free=function() {
		while (folders.length) close();
		yfs.free();
	}
	var currentsize=function() {
		return cur;
	}
	this.free=free;
	this.saveI32=saveI32;
	this.saveUI8=saveUI8;
	this.saveBool=saveBool;
	this.saveString=saveString;
	this.saveVInt=saveVInt;
	this.savePInt=savePInt;
	this.saveInts=saveInts;
	this.saveBlob=saveBlob;
	this.save=save;
	this.openArray=openArray;
	this.openObject=openObject;
	this.stringEncoding=stringEncoding;
	this.integerEncoding=integerEncoding;
	this.close=close;
	this.currentsize=currentsize;
}

module.exports=Create;