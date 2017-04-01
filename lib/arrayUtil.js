/**
 * Created by bryancross on 1/14/17.
 */

var arrayUtils = function() {};

//given an array and a key, determine the index matching the supplied value
//returns -1 if there is no match

arrayUtils.prototype.findValueInArray = function(array,value,key)
    {
        for(var i = 0;i < array.length; i++)
        {
            //deal with keyless arrays, liked commit.added
            if(key != null)
            {
                if(array[i][key] === value)
                {
                    return i;
                }
            }
            else if (array[i] === value)
            {
                return i;
            }
        }
        return null;
    };


arrayUtils.prototype.getArrayElementByKey = function(array,value, key)
{
    var index = this.findValueInArray(array,value,key)
    if(index != null)
    {
        return array[index];
    }
    else
    {
        return null;
    }



};


arrayUtils.prototype.findValueBetweenArrays = function(array1, array2, key1, key2) {
    for (var a = 0; a < array1.length; a++) {
        for (var b = 0; b < array2.length; b++) {
            if(array1[a][key1] === undefined || array2[b][key2] === undefined)
            {
                return null;
            }
            if ((array1[a][key1] === array2[b][key2]))
            {
                var retval = {array1index:a,array2index:b};
                return retval;
            }
        }
    }
    return null;
};

module.exports = new arrayUtils();
